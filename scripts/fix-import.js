const fs = require('fs');

const uiPath = 'ui/server/index.mjs';

let uiCode = fs.readFileSync(uiPath, 'utf8');

// Move import { createHash } from 'crypto'; to the top
uiCode = uiCode.replace("import { createHash } from 'crypto';", '');
uiCode = "import { createHash } from 'crypto';\n" + uiCode;

fs.writeFileSync(uiPath, uiCode);
