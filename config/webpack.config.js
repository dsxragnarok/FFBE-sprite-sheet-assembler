const fs = require('fs');
const path = require('path');

const appDirectory = fs.realpathSync(process.cwd());
const srcIndexJs = path.resolve(appDirectory, 'src/index.js');
const buildDirectory = path.resolve(appDirectory, 'build');

module.exports = {
    context: appDirectory,
    entry: srcIndexJs,
    output: {
        filename: 'ffbetool.js',
        path: buildDirectory,
    },
    target: 'node',
    module: {
        rules: [{
            test: /\.js$/,
            exclude: /node_modules/,
            loader: 'babel-loader',
        }],
    },
    node: {
        fs: 'empty',
    },
};
