const { generateResponseStream } = require('../lib/ollama');
const { getSelectedModel } = require('../lib/config');

async function generateCommand(options) {
  const { model: modelOption, prompt } = options;

  if (!prompt) {
    console.error('Please provide a prompt using -p or --prompt');
    return;
  }

  const model = modelOption || getSelectedModel() || 'llama3.2:latest';

  try {
    let fullResponse = '';
    await generateResponseStream(model, prompt, (chunk) => {
      fullResponse += chunk;
      process.stdout.write(chunk);
    });
    console.log('\n' + fullResponse);
  } catch (error) {
    console.error('Error generating response:', error.message);
  }
}

module.exports = { generateCommand };