const path = require('path')

const pkg = require('../packages/rn-zalo-toolkit/package.json')

module.exports = {
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..', 'packages', 'rn-zalo-toolkit'),
    },
  },
}
