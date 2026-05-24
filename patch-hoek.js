const fs = require('fs');
const path = require('path');

const hoekLibPath = path.join(process.cwd(), 'node_modules', '@hapi', 'hoek', 'lib');
const errorJsPath = path.join(hoekLibPath, 'error.js');

const errorJsContent = `'use strict';
const Stringify = require('./stringify');
const internals = {};
module.exports = class extends Error {
    constructor(args) {
        const msgs = args
            .filter((arg) => arg !== '')
            .map((arg) => {
                return typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : Stringify(arg);
            });
        super(msgs.join(' ') || 'Unknown error');
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, exports.assert);
        }
    }
};
`;

if (!fs.existsSync(hoekLibPath)) {
    console.log('Directorio @hapi/hoek/lib no encontrado, omitiendo parche.');
    process.exit(0);
}

try {
    if (!fs.existsSync(errorJsPath)) {
        console.log('Archivo error.js no encontrado en @hapi/hoek/lib. Creándolo...');
        fs.writeFileSync(errorJsPath, errorJsContent);
        console.log('Parche aplicado con éxito.');
    } else {
        console.log('El archivo error.js ya existe.');
    }
} catch (err) {
    console.error('Error al aplicar el parche:', err);
}
