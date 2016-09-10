'use strict';

var loader = 'ng-annotate!babel?presets[]=es2015';

module.exports = {
    entry: './src/scripts/main.js.liquid',
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                loader: loader
            },
            {
                test: /\.js.liquid$/,
                loader: loader
            }
        ]
    }
};
