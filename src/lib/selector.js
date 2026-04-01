const readline = require('readline');

function selectModelInteractively(models, currentModel = null) {
  if (!process.stdin.isTTY) {
    return Promise.resolve(models[0] || null);
  }

  return new Promise((resolve) => {
    let selectedIndex = currentModel ? models.indexOf(currentModel) : 0;
    if (selectedIndex < 0) selectedIndex = 0;

    const display = () => {
      process.stdout.write('\x1B[2J\x1B[0;0f');
      process.stdout.write('Select a model (use ↑↓ arrows, Enter to select):\n\n');
      models.forEach((model, index) => {
        process.stdout.write(index === selectedIndex ? `> ${model} \n` : `  ${model} \n`);
      });
      if (currentModel) {
        process.stdout.write(`\nCurrent selection: ${currentModel}\n`);
      }
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    display();

    const onKeypress = (chunk, key) => {
      if (key && key.ctrl && key.name === 'c') {
        process.stdin.setRawMode(false);
        rl.close();
        resolve(null);
        return;
      }

      if (key && key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + models.length) % models.length;
        display();
      } else if (key && key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % models.length;
        display();
      } else if (key && (key.name === 'return' || key.name === 'enter')) {
        process.stdin.setRawMode(false);
        rl.close();
        resolve(models[selectedIndex]);
      } else if (key && key.name === 'escape') {
        process.stdin.setRawMode(false);
        rl.close();
        resolve(null);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

module.exports = { selectModelInteractively };