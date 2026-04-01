const axios = require('axios');

const OLLAMA_API = 'http://localhost:11434/api';

async function fetchModels() {
  try {
    const response = await axios.get(`${OLLAMA_API}/tags`);
    return response.data.models.map(model => model.name);
  } catch (error) {
    console.error('Error fetching models:', error.message);
    return [];
  }
}

async function getModelInfo(modelName) {
  try {
    const response = await axios.post(`${OLLAMA_API}/show`, { name: modelName });
    return {
      contextWindow: response.data.context_window || 4096,
      model: response.data.model
    };
  } catch (error) {
    return { contextWindow: 4096, model: modelName };
  }
}

async function generateResponse(model, prompt) {
  const response = await axios.post(`${OLLAMA_API}/generate`, {
    model,
    prompt,
    stream: false
  });
  return response.data.response;
}

function generateResponseStream(model, prompt, onChunk) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await axios.post(`${OLLAMA_API}/generate`, {
        model,
        prompt,
        stream: true
      }, { responseType: 'stream' });

      let fullResponse = '';
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullResponse += data.response;
              onChunk(data.response);
            }
          } catch (e) {}
        }
      });

      response.data.on('end', () => resolve(fullResponse));
      response.data.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

class ChatMemory {
  constructor(contextWindow) {
    this.contextWindow = contextWindow;
    this.messages = [];
    this.maxTokens = 512;
  }

  addMessage(role, content) {
    this.messages.push({ role, content });
    this.trimToContextWindow();
  }

  getContext() {
    return this.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  }

  trimToContextWindow() {
    const reserved = this.maxTokens;
    let used = 0;

    for (const msg of this.messages) {
      used += msg.content.length + 50;
    }

    while (used > this.contextWindow - reserved && this.messages.length > 0) {
      used -= this.messages[0].content.length + 50;
      this.messages.shift();
    }
  }

  clear() {
    this.messages = [];
  }
}

module.exports = { fetchModels, getModelInfo, generateResponse, generateResponseStream, ChatMemory };