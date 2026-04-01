const { fetchModels } = require('../lib/ollama');
const { selectModelInteractively } = require('../lib/selector');
const { getSelectedModel, saveSelectedModel } = require('../lib/config');

async function listCommand(options) {
  const models = await fetchModels();
  if (models.length === 0) {
    console.log('No models available');
    return;
  }

  if (options && options.select) {
    const selected = await selectModelInteractively(models, getSelectedModel());
    if (selected) {
      saveSelectedModel(selected);
      console.log(`\nSelected model: ${selected}`);
    } else {
      console.log('\nSelection cancelled');
    }
    return;
  }

  console.log('Available Ollama models:');
  models.forEach(model => console.log(`- ${model}`));
}

module.exports = { listCommand };