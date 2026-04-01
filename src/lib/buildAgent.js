const fs = require('fs');
const path = require('path');
const { generateResponseStream } = require('./ollama');
const { ChatMemory } = require('./ollama');

const SYSTEM_PROMPT = `You are an expert developer agent with deep understanding of codebases.

Your capabilities:
- Read, write, and edit files in the working directory
- Execute shell commands
- Understand project structure and code
- Handle complex software engineering tasks

Available commands:
- READ <file> - Read contents of a file
- WRITE <file> <content> - Write content to a file (use | for newlines)
- EDIT <file> <oldString> <newString> - Replace oldString with newString
- RUN <command> - Execute a shell command
- LS <dir> - List directory contents
- GLOB <pattern> - Find files matching glob pattern
- GREP <pattern> <file?> - Search for pattern in files
- TREE <dir> - Show directory tree structure
- STAT <file> - Show file metadata
- EXISTS <file> - Check if file exists
- MKDIR <dir> - Create directory
- DELETE <file> - Delete a file

Context window usage is tracked. Keep responses concise and efficient.

When handling tasks:
1. First understand the project structure with LS and TREE
2. Read relevant files to understand the codebase
3. Plan your approach
4. Execute changes step by step
5. Verify changes with READ or RUN commands

Always be thorough but efficient with context window usage.`;

const PRIVILEGED_COMMANDS = ['WRITE', 'EDIT', 'RUN', 'DELETE', 'MKDIR'];
const SAFE_COMMANDS = ['READ', 'LS', 'GLOB', 'GREP', 'TREE', 'STAT', 'EXISTS'];

class BuildAgent {
  constructor(cwd, model, contextWindow = 4096) {
    this.cwd = cwd;
    this.model = model;
    this.contextWindow = contextWindow;
    this.memory = new ChatMemory(contextWindow);
    this.memory.addMessage('system', SYSTEM_PROMPT);
    this.projectContext = '';
    this.pendingCommands = [];
  }

  getContextUsage() {
    let used = 0;
    for (const msg of this.memory.messages) {
      used += msg.content.length + 50;
    }
    return Math.round((used / this.contextWindow) * 100);
  }

  async exploreProject() {
    const files = [];
    const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv'];

    const explore = (dir, depth = 0) => {
      if (depth > 4) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!ignoredDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              files.push({ type: 'dir', path: fullPath, depth });
              explore(fullPath, depth + 1);
            }
          } else {
            files.push({ type: 'file', path: fullPath, depth });
          }
        }
      } catch (e) {}
    };

    explore(this.cwd);
    return files;
  }

  async buildProjectContext() {
    const structure = await this.exploreProject();
    let context = 'Project Structure:\n';
    
    for (const item of structure.slice(0, 100)) {
      const indent = '  '.repeat(item.depth);
      if (item.type === 'dir') {
        context += `${indent}📁 ${path.basename(item.path)}/\n`;
      } else {
        context += `${indent}📄 ${path.basename(item.path)}\n`;
      }
    }
    
    if (structure.length > 100) {
      context += `\n... and ${structure.length - 100} more files\n`;
    }

    const readmePath = path.join(this.cwd, 'README.md');
    if (fs.existsSync(readmePath)) {
      context += `\n\nREADME.md:\n${fs.readFileSync(readmePath, 'utf8').slice(0, 1000)}`;
    }

    const packagePath = path.join(this.cwd, 'package.json');
    if (fs.existsSync(packagePath)) {
      context += `\n\npackage.json:\n${fs.readFileSync(packagePath, 'utf8').slice(0, 500)}`;
    }

    this.projectContext = context;
    return context;
  }

  getCommandType(command) {
    const cmd = command.split(' ')[0].toUpperCase();
    if (PRIVILEGED_COMMANDS.includes(cmd)) return 'privileged';
    if (SAFE_COMMANDS.includes(cmd)) return 'safe';
    return 'unknown';
  }

  async executeCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[0].toUpperCase();
    const args = parts.slice(1);

    try {
      switch (cmd) {
        case 'READ': {
          if (!args[0]) return 'Error: READ requires a file path';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${args[0]}`;
          }
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            return 'Error: Path is a directory, use LS instead';
          }
          let content = fs.readFileSync(filePath, 'utf8');
          if (content.length > 15000) {
            content = content.slice(0, 15000) + '\n... (truncated)';
          }
          return `File: ${args[0]}\n---\n${content}`;
        }

        case 'WRITE': {
          if (args.length < 2) return 'Error: WRITE requires file and content';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const content = args.slice(1).join(' ').replace(/\\n/g, '\n').replace(/\|/g, '\n');
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, content);
          return `Written to ${args[0]} (${content.length} chars)`;
        }

        case 'EDIT': {
          if (args.length < 3) return 'Error: EDIT requires file, oldString, newString';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${args[0]}`;
          }
          const oldString = args.slice(1, -1).join(' ').replace(/\\n/g, '\n').replace(/\|/g, '\n');
          const newString = args[args.length - 1].replace(/\\n/g, '\n').replace(/\|/g, '\n');
          let content = fs.readFileSync(filePath, 'utf8');
          if (!content.includes(oldString)) {
            return `Error: oldString not found in file`;
          }
          content = content.replace(oldString, newString);
          fs.writeFileSync(filePath, content);
          return `Edited ${args[0]} successfully`;
        }

        case 'RUN': {
          const cmdToRun = args.join(' ');
          if (!cmdToRun.trim()) return 'Error: RUN requires a command';
          const { execSync } = require('child_process');
          try {
            const output = execSync(cmdToRun, { cwd: this.cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
            return output || '(no output)';
          } catch (error) {
            return `Error: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
          }
        }

        case 'LS': {
          const dir = args[0] || '.';
          const dirPath = path.resolve(this.cwd, dir);
          if (!dirPath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          if (!fs.existsSync(dirPath)) {
            return `Error: Directory not found: ${dir}`;
          }
          const files = fs.readdirSync(dirPath);
          return files.map(f => {
            const fullPath = path.join(dirPath, f);
            const stat = fs.statSync(fullPath);
            return stat.isDirectory() ? `📁 ${f}/` : `📄 ${f}`;
          }).join('\n');
        }

        case 'GLOB': {
          const pattern = args[0] || '*';
          const { execSync } = require('child_process');
          try {
            const output = execSync(`find . -name "${pattern}" -type f 2>/dev/null | head -50`, { cwd: this.cwd, encoding: 'utf8' });
            return output || '(no matches)';
          } catch (e) {
            return `Error: No files matching ${pattern}`;
          }
        }

        case 'GREP': {
          if (args.length < 1) return 'Error: GREP requires a pattern';
          const pattern = args[0];
          const fileFilter = args[1];
          const { execSync } = require('child_process');
          try {
            let cmd = `grep -rn "${pattern}" . 2>/dev/null`;
            if (fileFilter) {
              cmd = `grep -rn "${pattern}" --include="${fileFilter}" . 2>/dev/null`;
            }
            const output = execSync(cmd, { cwd: this.cwd, encoding: 'utf8', timeout: 10000 });
            const lines = output.split('\n').slice(0, 50);
            return lines.join('\n') || '(no matches)';
          } catch (e) {
            return `No matches found for: ${pattern}`;
          }
        }

        case 'TREE': {
          const dir = args[0] || '.';
          const dirPath = path.resolve(this.cwd, dir);
          if (!dirPath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          const { execSync } = require('child_process');
          try {
            const output = execSync(`find . -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | head -100`, { cwd: dirPath, encoding: 'utf8' });
            return output.slice(0, 3000) || '(empty directory)';
          } catch (e) {
            return '(empty or inaccessible)';
          }
        }

        case 'STAT': {
          if (!args[0]) return 'Error: STAT requires a file path';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${args[0]}`;
          }
          const stats = fs.statSync(filePath);
          return `File: ${args[0]}
Size: ${stats.size} bytes
Created: ${stats.birthtime}
Modified: ${stats.mtime}
Is Directory: ${stats.isDirectory()}
Is File: ${stats.isFile()}`;
        }

        case 'EXISTS': {
          if (!args[0]) return 'Error: EXISTS requires a file path';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          return fs.existsSync(filePath) ? 'Yes, file exists' : 'No, file does not exist';
        }

        case 'MKDIR': {
          if (!args[0]) return 'Error: MKDIR requires a directory path';
          const dirPath = path.resolve(this.cwd, args[0]);
          if (!dirPath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          fs.mkdirSync(dirPath, { recursive: true });
          return `Created directory: ${args[0]}`;
        }

        case 'DELETE': {
          if (!args[0]) return 'Error: DELETE requires a file path';
          const filePath = path.resolve(this.cwd, args[0]);
          if (!filePath.startsWith(this.cwd)) {
            return 'Error: Path outside working directory';
          }
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${args[0]}`;
          }
          fs.unlinkSync(filePath);
          return `Deleted: ${args[0]}`;
        }

        default:
          return `Unknown command: ${cmd}. Use READ, WRITE, EDIT, RUN, LS, GLOB, GREP, TREE, STAT, EXISTS, MKDIR, or DELETE.`;
      }
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  parseCommands(response) {
    const safeCommands = [];
    const privilegedCommands = [];

    const commandBlocks = response.match(/\[COMMAND\]\n?([\s\S]*?)\n?\[\/COMMAND\]/gi) || [response];
    
    for (const block of commandBlocks) {
      const commands = block.replace(/\[COMMAND\]\n?/gi, '').replace(/\n?\[\/COMMAND\]/gi, '').trim();
      const commandLines = commands.split('\n').filter(l => l.trim());
      
      for (const command of commandLines) {
        const trimmed = command.trim();
        const cmdType = this.getCommandType(trimmed);
        if (cmdType === 'safe' && /^(READ|LS|GLOB|GREP|TREE|STAT|EXISTS)\s/i.test(trimmed)) {
          safeCommands.push(trimmed);
        } else if (cmdType === 'privileged' && /^(WRITE|EDIT|RUN|DELETE|MKDIR)\s/i.test(trimmed)) {
          privilegedCommands.push(trimmed);
        }
      }
    }

    return { safeCommands, privilegedCommands };
  }

  async processInput(userInput, onChunk = null) {
    this.memory.addMessage('user', userInput);

    const projectInfo = await this.buildProjectContext();
    const contextUsage = this.getContextUsage();
    
    const systemPrompt = `Current project context:\n${projectInfo}\n\nContext window usage: ${contextUsage}%

SAFE commands (auto-executed): READ, LS, GLOB, GREP, TREE, STAT, EXISTS
PRIVILEGED commands (require approval): WRITE, EDIT, RUN, DELETE, MKDIR`;

    const conversation = `${systemPrompt}\n\n${this.memory.getContext()}\n\nUser: ${userInput}\n\nFormat your response with commands wrapped in XML-like tags:\n[COMMAND]\nREAD src/file.js\nWRITE src/file.js content here\n[/COMMAND]\n\nFor privileged commands like WRITE, EDIT, RUN, DELETE, MKDIR - the user will be asked to approve them.`;

    let fullResponse = '';
    
    if (onChunk) {
      let currentBlock = '';
      await generateResponseStream(this.model, conversation, (chunk) => {
        fullResponse += chunk;
        currentBlock += chunk;
        if (currentBlock.includes('\n') || currentBlock.includes('[/COMMAND]')) {
          onChunk(currentBlock);
          currentBlock = '';
        }
      });
    } else {
      const { generateResponse } = require('./ollama');
      fullResponse = await generateResponse(this.model, conversation);
    }

    const { safeCommands, privilegedCommands } = this.parseCommands(fullResponse);

    this.pendingCommands = [...privilegedCommands];

    const safeResults = [];
    for (const cmd of safeCommands) {
      const result = await this.executeCommand(cmd);
      safeResults.push({ command: cmd, result, type: 'safe' });
    }

    let summary = '';
    if (safeResults.length > 0) {
      summary += safeResults.map(r => `Command: ${r.command}\nResult: ${r.result}`).join('\n---\n');
    }

    if (privilegedCommands.length > 0) {
      summary += `\n\n⚠️ PRIVILEGED COMMANDS REQUIRING APPROVAL:\n`;
      privilegedCommands.forEach((cmd, i) => {
        summary += `[${i + 1}] ${cmd}\n`;
      });
      summary += `\nAwaiting user approval...`;
    }

    if (safeCommands.length === 0 && privilegedCommands.length === 0) {
      summary = fullResponse;
    }

    this.memory.addMessage('assistant', summary || `Output: ${fullResponse}`);
    
    return {
      summary,
      safeResults,
      privilegedCommands,
      pendingApproval: privilegedCommands.length > 0
    };
  }

  async executePrivilegedCommands(approvedIndices) {
    const results = [];
    for (const index of approvedIndices) {
      if (index >= 0 && index < this.pendingCommands.length) {
        const cmd = this.pendingCommands[index];
        const result = await this.executeCommand(cmd);
        results.push({ command: cmd, result });
      }
    }
    this.pendingCommands = [];
    return results;
  }

  async executeAllPrivilegedCommands() {
    return this.executePrivilegedCommands(
      this.pendingCommands.map((_, i) => i)
    );
  }

  getPendingCommands() {
    return this.pendingCommands;
  }

  clearPendingCommands() {
    this.pendingCommands = [];
  }

  clearMemory() {
    this.memory.clear();
    this.memory.addMessage('system', SYSTEM_PROMPT);
    this.projectContext = '';
  }
}

module.exports = { BuildAgent };