const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { generateResponse } = require('./ollama');
const { getSelectedModel } = require('./config');
const { ChatMemory } = require('./ollama');

const TOOL_PROMPT = `You are a build agent. You can help users modify files in the project directory.

Available commands:
- READ <file> - Read contents of a file
- WRITE <file> <content> - Write content to a file (use | for newlines)
- EDIT <file> <oldString> <newString> - Replace oldString with newString in file
- RUN <command> - Execute a shell command
- LS <dir> - List directory contents

When modifying files:
- Always verify the file exists before modifying
- Use EDIT for small changes, WRITE for full rewrites
- Be careful with path traversal attacks

Respond with a command to execute the user's request.`;

class BuildAgent {
  constructor(cwd, model, contextWindow = 4096) {
    this.cwd = cwd;
    this.model = model;
    this.memory = new ChatMemory(contextWindow);
    this.memory.addMessage('system', TOOL_PROMPT);
  }

  async executeCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[0].toUpperCase();
    const args = parts.slice(1);

    try {
      switch (cmd) {
        case 'READ': {
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const content = fs.readFileSync(filePath, 'utf8');
          return `File: ${args[0]}\n---\n${content}`;
        }

        case 'WRITE': {
          if (args.length < 2) return 'Error: WRITE requires file and content';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const content = args.slice(1).join(' ').replace(/\\n/g, '\n');
          fs.writeFileSync(filePath, content);
          return `Written to ${args[0]}`;
        }

        case 'EDIT': {
          if (args.length < 3) return 'Error: EDIT requires file, oldString, newString';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const oldString = args.slice(1, -1).join(' ').replace(/\\n/g, '\n');
          const newString = args[args.length - 1].replace(/\\n/g, '\n');
          let content = fs.readFileSync(filePath, 'utf8');
          if (!content.includes(oldString)) {
            return `Error: oldString not found in file`;
          }
          content = content.replace(oldString, newString);
          fs.writeFileSync(filePath, content);
          return `Edited ${args[0]}`;
        }

        case 'RUN': {
          const command = args.join(' ');
          const { execSync } = require('child_process');
          const output = execSync(command, { cwd: this.cwd, encoding: 'utf8', timeout: 30000 });
          return output || '(no output)';
        }

        case 'LS': {
          const dir = args[0] || '.';
          const dirPath = path.resolve(this.cwd, dir);
          if (!dirPath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const files = fs.readdirSync(dirPath);
          return files.join('\n');
        }

        default:
          return `Unknown command: ${cmd}`;
      }
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  async processInput(userInput) {
    this.memory.addMessage('user', userInput);
    
    const conversation = this.memory.getContext() + 
      `\nUser: ${userInput}\n\nRespond with a single command (READ, WRITE, EDIT, RUN, or LS). Only output the command, nothing else.`;
    
    const response = await generateResponse(this.model, conversation);
    const command = response.trim();
    
    const result = await this.executeCommand(command);
    this.memory.addMessage('assistant', `Command: ${command}\nResult: ${result}`);
    
    return result;
  }

  clearMemory() {
    this.memory.clear();
    this.memory.addMessage('system', TOOL_PROMPT);
  }
}

module.exports = { BuildAgent };