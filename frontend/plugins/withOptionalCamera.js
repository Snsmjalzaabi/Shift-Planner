const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_CAMERA_FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
];

module.exports = function withOptionalCamera(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const features = manifest['uses-feature'] ?? [];

    for (const featureName of OPTIONAL_CAMERA_FEATURES) {
      const existingFeature = features.find(
        (feature) => feature.$?.['android:name'] === featureName,
      );

      if (existingFeature) {
        existingFeature.$['android:required'] = 'false';
      } else {
        features.push({
          $: {
            'android:name': featureName,
            'android:required': 'false',
          },
        });
      }
    }

    manifest['uses-feature'] = features;
    return androidConfig;
  });
};
