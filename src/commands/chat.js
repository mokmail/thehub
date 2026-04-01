const readline = require('readline');
const { fetchModels, getModelInfo, generateResponse, ChatMemory } = require('../lib/ollama');
const { selectModelInteractively } = require('../lib/selector');
const { getSelectedModel } = require('../lib/config');

async function chatCommand(options) {
  let { model, selectModel } = options;

  if (selectModel) {
    const models = await fetchModels();
    if (models.length === 0) {
      console.error('No models available');
      return;
    }
    const selected = await selectModelInteractively(models, getSelectedModel());
    if (!selected) {
      console.log('Model selection cancelled');
      return;
    }
    model = selected;
  }

  if (!model) {
    model = getSelectedModel() || 'llama3.2:latest';
  }

  const modelInfo = await getModelInfo(model);
  const memory = new ChatMemory(modelInfo.contextWindow);

  console.log(`Starting chat with model: ${model} (context: ${modelInfo.contextWindow})`);
  console.log('Type "exit" or "quit" to end the session, "clear" to clear memory\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You: '
  });

  rl.prompt();

  rl.on('line', async (input) => {
    const cmd = input.toLowerCase().trim();
    if (cmd === 'exit' || cmd === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }

    if (cmd === 'clear') {
      memory.clear();
      console.log('Memory cleared\n');
      rl.prompt();
      return;
    }

    try {
      memory.addMessage('user', input);
      const promptWithContext = memory.getPromptWithContext(input);
      const response = await generateResponse(model, promptWithContext);
      memory.addMessage('assistant', response);
      console.log(`Assistant: ${response}\n`);
      rl.prompt();
    } catch (error) {
      console.error('Error communicating with Ollama:', error.message);
      rl.prompt();
    }
  });

  rl.on('close', () => process.exit(0));
}

module.exports = { chatCommand };