const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.env.HOME, '.thehub');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (error) {}
  return {};
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config:', error.message);
  }
}

function getSelectedModel() {
  const config = getConfig();
  return config.selectedModel || null;
}

function saveSelectedModel(model) {
  const config = getConfig();
  config.selectedModel = model;
  saveConfig(config);
}

module.exports = { getSelectedModel, saveSelectedModel };