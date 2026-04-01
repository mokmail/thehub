#!/usr/bin/env node

const { program } = require('commander');
const { createTUI } = require('./src/tui');
const { fetchModels, getModelInfo, generateResponse } = require('./src/lib/ollama');
const { listCommand } = require('./src/commands/list');
const { chatCommand } = require('./src/commands/chat');
const { generateCommand } = require('./src/commands/generate');

program
  .name('thehub')
  .description('CLI tool for interacting with Ollama AI models')
  .version('1.0.0');

program
  .command('tui')
  .description('Launch the interactive TUI (default)')
  .action(() => {
    createTUI({ fetchModels, getModelInfo, generateResponse });
  });

program
  .command('list')
  .description('List available Ollama models')
  .option('-s, --select', 'Interactively select a model')
  .action(async (options) => {
    await listCommand(options);
  });

program
  .command('chat')
  .description('Start a chat session with an Ollama model')
  .option('-m, --model <model>', 'Model to use')
  .option('--select-model', 'Interactively select model with arrow keys')
  .action(async (options) => {
    await chatCommand(options);
  });

program
  .command('generate')
  .description('Generate a response from a prompt')
  .option('-m, --model <model>', 'Model to use')
  .option('-p, --prompt <prompt>', 'Prompt to send to the model')
  .action(async (options) => {
    await generateCommand(options);
  });

program.parse();