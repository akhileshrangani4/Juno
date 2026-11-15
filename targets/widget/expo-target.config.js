// The Juno home-screen and Lock Screen widget, built by @bacons/apple-targets on every expo prebuild.
// It only opens links into the app (juno://feed, juno://agent): no App Group, no shared data.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'JunoWidget',
  displayName: 'Juno',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  colors: {
    $widgetBackground: '#0F1B3D',
    $accent: '#F1BC4C',
  },
};
