const pdf = require('pdf-parse');
console.log('Type of pdf:', typeof pdf);
console.log('pdf export:', pdf);

try {
    if (typeof pdf === 'function') {
        console.log('pdf is a function');
    } else {
        console.log('pdf is NOT a function');
        if (pdf.default) {
            console.log('pdf.default exists:', typeof pdf.default);
        }
    }
} catch (e) {
    console.error(e);
}
