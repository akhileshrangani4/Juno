// Adds plugins/shortcuts/JunoShortcuts.swift (the Siri, Shortcuts and Action Button commands) to the app target
// on every expo prebuild. App Shortcuts must live in the app itself, so they cannot go in the widget target.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const FILE = 'JunoShortcuts.swift';

module.exports = function withAppShortcuts(config) {
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const name = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
      fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'plugins', 'shortcuts', FILE), path.join(mod.modRequest.platformProjectRoot, name, FILE));
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    const name = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
    const filepath = path.join(name, FILE);
    if (!mod.modResults.hasFile(filepath)) IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project: mod.modResults });
    return mod;
  });
};
