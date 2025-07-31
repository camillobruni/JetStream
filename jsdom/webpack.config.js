import path from 'path';
import webpack from 'webpack';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'jsdom.js',
    library: {
      name: 'JSDOM_BUNDLE',
      type: 'global',
    },
  },
  resolve: {
    fallback: {
      "assert": "assert/",
      "buffer": "buffer/",
      "crypto": "crypto-browserify",
      "fs": false,
      "http": "stream-http",
      "https": "https-browserify",
      "net": false,
      "os": "os-browserify/browser",
      "path": "path-browserify",
      "stream": "stream-browserify",
      "tls": false,
      "url": "url/",
      "util": "util/",
      "vm": "vm-browserify",
      "zlib": "browserify-zlib",
      "child_process": false,
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
    ],
  },
  externals: {
    canvas: 'commonjs canvas',
  },
  mode: 'production',
};