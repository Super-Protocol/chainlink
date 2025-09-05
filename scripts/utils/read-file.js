const fs = require('fs');
const path = require('path');

const readFileContentAsString = (filePath, fileDescription) => {
  const absolutePath = path.resolve(filePath);

  try {
    if (!fs.existsSync(absolutePath)) {
      console.warn(`${fileDescription} not found at ${absolutePath}`);
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    if (!content || content.trim() === '') {
      console.warn(`${fileDescription} at ${absolutePath} is empty.`);
      return;
    }

    console.log(`Successfully read ${fileDescription} from ${absolutePath}`);
    return content;
  } catch (error) {
    console.error(`Failed to read ${fileDescription} at ${absolutePath}: ${error.message}`);
    return;
  }
};

module.exports = { readFileContentAsString };
