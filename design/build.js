import StyleDictionary from 'style-dictionary';

const readValue = (token) =>
  token.value ?? token.$value ?? token.original?.value ?? token.original?.$value;
const readType = (token) =>
  token.type ?? token.$type ?? token.original?.type ?? token.original?.$type;

const dimensionFilter = (token) => readType(token) === 'dimension';
const fontFamilyFilter = (token) => readType(token) === 'fontFamily';

StyleDictionary.registerTransform({
  name: 'size/css/px',
  type: 'value',
  filter: dimensionFilter,
  transform: (token) => `${parseFloat(readValue(token))}px`,
});

StyleDictionary.registerTransform({
  name: 'size/js/number',
  type: 'value',
  filter: dimensionFilter,
  transform: (token) => parseFloat(readValue(token)),
});

StyleDictionary.registerTransform({
  name: 'size/swift/cgfloat',
  type: 'value',
  filter: dimensionFilter,
  transform: (token) => `CGFloat(${parseFloat(readValue(token))})`,
});

StyleDictionary.registerTransform({
  name: 'size/android/dp',
  type: 'value',
  filter: dimensionFilter,
  transform: (token) => `${parseFloat(readValue(token))}dp`,
});

StyleDictionary.registerTransform({
  name: 'font/swift/quoted',
  type: 'value',
  filter: fontFamilyFilter,
  transform: (token) => `"${readValue(token)}"`,
});

const sharedSources = [
  'tokens/typography.json',
  'tokens/radius.json',
  'tokens/spacing.json',
];

const platforms = (theme) => ({
  webCss: {
    transforms: ['attribute/cti', 'name/kebab', 'color/css', 'size/css/px'],
    buildPath: `build/web/${theme}/`,
    files: [
      { destination: 'tokens.css', format: 'css/variables' },
    ],
  },
  webJs: {
    transforms: ['attribute/cti', 'name/camel', 'color/hex', 'size/js/number'],
    buildPath: `build/web/${theme}/`,
    files: [
      { destination: 'tokens.ts', format: 'javascript/es6' },
    ],
  },
  ios: {
    transforms: [
      'attribute/cti',
      'name/camel',
      'color/UIColorSwift',
      'size/swift/cgfloat',
      'font/swift/quoted',
    ],
    buildPath: `build/ios/${theme}/`,
    files: [
      {
        destination: 'Tokens.swift',
        format: 'ios-swift/class.swift',
        options: { className: 'Tokens', packageName: 'Prism' },
      },
    ],
  },
  android: {
    transforms: [
      'attribute/cti',
      'name/snake',
      'color/hex8android',
      'size/android/dp',
    ],
    buildPath: `build/android/${theme}/`,
    files: [
      { destination: 'colors.xml', format: 'android/colors' },
      { destination: 'dimens.xml', format: 'android/dimens' },
    ],
  },
});

for (const theme of ['light', 'dark']) {
  const sd = new StyleDictionary({
    source: [`tokens/color/${theme}.json`, ...sharedSources],
    usesDtcg: true,
    platforms: platforms(theme),
  });
  await sd.buildAllPlatforms();
}
