const blessed = require('blessed');
const { generateResponseStream, ChatMemory } = require('./lib/ollama');
const { getSelectedModel, saveSelectedModel } = require('./lib/config');
const { BuildAgent } = require('./lib/buildAgent');

function createTUI({ fetchModels, getModelInfo, generateResponse }) {
  let currentModel = null;
  let models = [];
  let memory = null;
  let modelInfo = { contextWindow: 4096 };
  let selectedIndex = 0;
  let view = 'main';
  let chatHistory = [];
  let inputBuffer = '';
  let isLoading = false;
  let buildAgent = null;

  const screen = blessed.screen({ smartSDrift: true });
  screen.title = 'bev - Ollama CLI';

  const header = blessed.text({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: ' bev - Ollama CLI ',
    style: { fg: 'black', bg: 'red', bold: true }
  });

  const modelBar = blessed.text({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: 1,
    content: ' Model: none selected ',
    style: { fg: 'white', bg: 'red' }
  });

  const mainPanel = blessed.text({
    parent: screen,
    top: 4,
    left: 0,
    width: '100%-2',
    height: '100%-7',
    border: { type: 'line' },
    style: { border: { fg: 'white' } },
    tags: true,
    scrollable: true,
    alwaysScroll: true
  });

  const statusBar = blessed.text({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' [tab] Switch view | [q] Quit | [Enter] Select/Confirm ',
    style: { fg: 'black', bg: 'white' }
  });

  const inputBar = blessed.text({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    content: '',
    style: { fg: 'white', bg: 'grey' }
  });

  const listPanel = blessed.list({
    parent: screen,
    top: 4,
    left: 0,
    width: '100%-2',
    height: '100%-7',
    border: { type: 'line' },
    style: { selected: { bg: 'red' } },
    hidden: true
  });

  function renderMain() {
    let content = '{center}{bold}{red-fg}bev{/red-fg}{/bold}{/center}\n\n';
    content += 'Available commands:\n\n';
    content += '  [l] List/select models - Show and optionally select a model\n';
    content += '  [c] Chat           - Start chat session\n';
    content += '  [g] Generate       - Single prompt generation\n';
    content += '  [b] Build          - Build agent for file operations\n';
    content += '  [q] Quit           - Exit the application\n\n';
    content += `{bold}Current Model:{/bold} ${currentModel || 'none'}\n`;
    if (memory) {
      content += `{bold}Memory:{/bold} ${memory.messages.length} messages\n`;
    }
    if (buildAgent) {
      content += `{bold}Build Agent:{/bold} Active (${buildAgent.cwd})\n`;
    }
    mainPanel.setContent(content);
  }

  function renderChat() {
    let content = '';
    chatHistory.forEach((msg, i) => {
      const prefix = msg.role === 'user' ? 'You' : 'Bot';
      const color = msg.role === 'user' ? 'red-fg' : 'green-fg';
      content += `{${color}}{bold}${prefix}:{/bold}{/} ${msg.content}\n\n`;
    });
    if (isLoading) {
      content += '{white-fg}Thinking...{/}\n';
    }
    if (!content) {
      content = 'Type your message and press Enter to chat\n';
      content += 'Type "q" to return to main menu\n';
    }
    mainPanel.setContent(content);
    mainPanel.setScrollPerc(100);
  }

  function renderModels() {
    let content = '{center}{bold}Select a Model{/bold}{/center}\n\n';
    models.forEach((model, i) => {
      const marker = i === selectedIndex ? '> ' : '  ';
      if (i === selectedIndex) {
        content += `{white-fg}${marker}${model}{/white-fg}\n`;
      } else {
        content += `{white-fg}${marker}${model}{/white-fg}\n`;
      }
    });
    if (currentModel) {
      content += `\n{green-fg}Current: ${currentModel}{/green-fg}\n`;
    }
    mainPanel.setContent(content);
  }

  function renderGenerate() {
    let content = '{center}{bold}Generate Response{/bold}{/center}\n\n';
    content += `Model: ${currentModel || 'none'}\n\n`;
    content += 'Type your prompt and press Enter\n';
    content += 'Type "back" to return to main menu\n';
    if (chatHistory.length > 0) {
      content += '\n{bold}Last response:{/bold}\n';
      const last = chatHistory[chatHistory.length - 1];
      if (last && last.role === 'assistant') {
        content += last.content.substring(0, 200) + (last.content.length > 200 ? '...' : '');
      }
    }
    mainPanel.setContent(content);
    mainPanel.setScrollPerc(100);
  }

  function renderBuild() {
    let content = '{center}{bold}Build Agent{/bold}{/center}\n\n';
    content += `Working directory: ${buildAgent ? buildAgent.cwd : process.cwd()}\n`;
    content += 'Type natural language commands to modify files\n';
    content += 'Type "back" to return to main menu\n\n';
    chatHistory.forEach((msg) => {
      const prefix = msg.role === 'user' ? 'You' : 'Bot';
      const color = msg.role === 'user' ? 'red-fg' : 'green-fg';
      content += `{${color}}{bold}${prefix}:{/bold}{/} ${msg.content}\n\n`;
    });
    if (isLoading) {
      content += '{white-fg}Processing...{/}\n';
    }
    mainPanel.setContent(content);
    mainPanel.setScrollPerc(100);
  }

  function refresh() {
    if (view === 'main') renderMain();
    else if (view === 'chat') renderChat();
    else if (view === 'models') renderModels();
    else if (view === 'generate') renderGenerate();
    else if (view === 'build') renderBuild();

    modelBar.setContent(` Model: ${currentModel || 'none'} | Context: ${modelInfo.contextWindow} `);
    inputBar.setContent(` > ${inputBuffer}`);
    screen.render();
  }

  async function loadModels() {
    models = await fetchModels();
    selectedIndex = models.indexOf(currentModel);
    if (selectedIndex < 0) selectedIndex = 0;
  }

  async function selectModel(modelName) {
    currentModel = modelName;
    saveSelectedModel(modelName);
    modelInfo = await getModelInfo(modelName);
    memory = new ChatMemory(modelInfo.contextWindow);
    chatHistory = [];
    view = 'main';
    refresh();
  }

  async function sendMessage(text) {
    if (!text.trim()) return;
    if (text.toLowerCase() === 'exit') {
      view = 'main';
      chatHistory = [];
      refresh();
      return;
    }

    chatHistory.push({ role: 'user', content: text });
    memory.addMessage('user', text);
    isLoading = true;
    refresh();

    try {
      const prompt = memory.getContext();
      let fullResponse = '';
      chatHistory.push({ role: 'assistant', content: '' });
      await generateResponseStream(currentModel, prompt, (chunk) => {
        fullResponse += chunk;
        chatHistory[chatHistory.length - 1].content = fullResponse;
        refresh();
      });
      memory.addMessage('assistant', fullResponse);
    } catch (error) {
      chatHistory.push({ role: 'assistant', content: `Error: ${error.message}` });
    }

    isLoading = false;
    refresh();
  }

  screen.on('keypress', async (ch, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }

    const goBack = () => {
      if (view === 'list') {
        listPanel.hidden = true;
      }
      view = 'main';
      chatHistory = [];
      inputBuffer = '';
      refresh();
    };

    const quit = () => {
      process.exit(0);
    };

    if (view === 'main') {
      if (key.name === 'q') {
        quit();
      } else if (key.name === 'l') {
        await loadModels();
        view = 'list';
        listPanel.hidden = false;
        listPanel.setItems(models);
        listPanel.focus();
        refresh();
      } else if (key.name === 'c') {
        if (!currentModel) {
          view = 'models';
          refresh();
        } else {
          view = 'chat';
          chatHistory = [];
          refresh();
        }
      } else if (key.name === 'g') {
        if (!currentModel) {
          view = 'models';
          refresh();
        } else {
          view = 'generate';
          inputBuffer = '';
          refresh();
        }
      } else if (key.name === 'b') {
        if (!currentModel) {
          view = 'models';
          refresh();
        } else {
          if (!buildAgent) {
            buildAgent = new BuildAgent(process.cwd(), currentModel, modelInfo.contextWindow);
          }
          chatHistory = [];
          view = 'build';
          refresh();
        }
      }
    } else if (view === 'models') {
      if (key.name === 'escape') {
        goBack();
      } else if (key.name === 'q') {
        goBack();
      } else if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + models.length) % models.length;
        refresh();
      } else if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % models.length;
        refresh();
      } else if (key.name === 'enter') {
        if (models[selectedIndex]) {
          await selectModel(models[selectedIndex]);
        }
      }
    } else if (view === 'chat') {
      if (key.name === 'escape') {
        goBack();
      } else if (key.name === 'q') {
        goBack();
      } else if (key.name === 'enter') {
        await sendMessage(inputBuffer);
        inputBuffer = '';
        refresh();
      } else if (key.name === 'backspace') {
        inputBuffer = inputBuffer.slice(0, -1);
        refresh();
      } else if (ch) {
        inputBuffer += ch;
        refresh();
      }
    } else if (view === 'generate') {
      if (key.name === 'escape') {
        goBack();
      } else if (key.name === 'q') {
        goBack();
      } else if (key.name === 'enter') {
        if (inputBuffer.toLowerCase() === 'back') {
          view = 'main';
          inputBuffer = '';
        } else if (inputBuffer.trim()) {
          isLoading = true;
          const prompt = inputBuffer;
          inputBuffer = '';
          refresh();
          try {
            let fullResponse = '';
            chatHistory.push({ role: 'assistant', content: '' });
            await generateResponseStream(currentModel, prompt, (chunk) => {
              fullResponse += chunk;
              chatHistory[chatHistory.length - 1].content = fullResponse;
              refresh();
            });
          } catch (error) {
            chatHistory.push({ role: 'assistant', content: `Error: ${error.message}` });
          }
          isLoading = false;
        }
        refresh();
      } else if (key.name === 'backspace') {
        inputBuffer = inputBuffer.slice(0, -1);
        refresh();
      } else if (ch) {
        inputBuffer += ch;
        refresh();
      }
    } else if (view === 'build') {
      if (key.name === 'escape') {
        goBack();
      } else if (key.name === 'q') {
        goBack();
      } else if (key.name === 'enter') {
        if (inputBuffer.trim()) {
          isLoading = true;
          refresh();
          try {
            const result = await buildAgent.processInput(inputBuffer);
            chatHistory.push({ role: 'user', content: inputBuffer });
            chatHistory.push({ role: 'assistant', content: result });
          } catch (error) {
            chatHistory.push({ role: 'assistant', content: `Error: ${error.message}` });
          }
          inputBuffer = '';
          isLoading = false;
          refresh();
        }
      } else if (key.name === 'backspace') {
        inputBuffer = inputBuffer.slice(0, -1);
        refresh();
      } else if (ch) {
        inputBuffer += ch;
        refresh();
      }
    } else if (view === 'list') {
      if (key.name === 'escape') {
        goBack();
      } else if (key.name === 'q') {
        goBack();
      } else if (key.name === 'up') {
        listPanel.up();
        selectedIndex = listPanel.selected;
        refresh();
      } else if (key.name === 'down') {
        listPanel.down();
        selectedIndex = listPanel.selected;
        refresh();
      } else if (key.name === 'enter') {
        const selected = models[listPanel.selected];
        if (selected) {
          listPanel.hidden = true;
          await selectModel(selected);
        }
      }
    }
  });

  screen.key(['tab'], () => {
    if (view === 'list') {
      view = 'main';
      listPanel.hidden = true;
      refresh();
    }
  });

  async function init() {
    currentModel = getSelectedModel();
    if (currentModel) {
      modelInfo = await getModelInfo(currentModel);
      memory = new ChatMemory(modelInfo.contextWindow);
    }
    renderMain();
    refresh();
  }

  init();

  return screen;
}

module.exports = { createTUI };