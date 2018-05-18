// Protractor configuration file, see link for more information
// https://github.com/angular/protractor/blob/master/lib/config.ts

const {SpecReporter} = require('jasmine-spec-reporter')

exports.config = {
  allScriptsTimeout: 11000,
  specs: [
    './src/**/*.e2e-spec.ts'
  ],

  seleniumAddress: 'http://hub-cloud.browserstack.com/wd/hub',
  commonCapabilities: {
    'browserstack.user': process.env.BROWSERSTACK_USER,
    'browserstack.key': process.env.BROWSERSTACK_KEY,
    'browserstack.local': true,
    'project': 'PeerTube'
  },

  multiCapabilities: [
    {
      browserName: 'Chrome',
      version: '66'
    },
    {
      browserName: 'Chrome',
      version: '66',
      os: 'android',

    },
    {
      browserName: 'Safari',
      version: '11.1'
    },
    {
      browserName: 'Firefox',
      version: '52' // ESR
    },
    {
      browserName: 'Firefox',
      version: '60'
    },
    {
      browserName: 'Edge',
      version: '17'
    }
  ],

  maxSessions: 1,
  baseUrl: 'http://localhost:4200/',
  framework: 'jasmine',
  jasmineNodeOpts: {
    showColors: true,
    defaultTimeoutInterval: 30000,
    print: function () {}
  },

  onPrepare () {
    require('ts-node').register({
      project: require('path').join(__dirname, './tsconfig.e2e.json')
    })
    jasmine.getEnv().addReporter(new SpecReporter({spec: {displayStacktrace: true}}))
  }
}

exports.config.multiCapabilities.forEach(function (caps) {
  for (var i in exports.config.commonCapabilities) caps[i] = caps[i] || exports.config.commonCapabilities[i]
})
