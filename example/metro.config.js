const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

const workspaceRoot = path.resolve(__dirname, '..')

/**
 * Metro has to see the library source that lives outside this app, and it must
 * resolve every module from the workspace root so React is not loaded twice.
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
