"use strict";
var vows = require('vows')
, assert = require('assert')
, log4js = require('../lib/log4js')
, sandbox = require('sandboxed-module')
;

log4js.clearAppenders();
require('../lib/logger').setDispatch(log4js.dispatch);

function setupLogging(category, options) {
  var msgs = [];
  
  var fakeMailer = {
		createTransport: function (name, options) {
			return {
				config: options,
				sendMail: function (msg, callback) {
          msgs.push(msg);
          callback(null, true);
        },
        close: function() {}
			};
		}
  };

  var fakeLayouts = {
    layout: function(type, config) {
      this.type = type;
      this.config = config;
      return log4js.layouts.messagePassThroughLayout;
    },
    basicLayout: log4js.layouts.basicLayout,
    messagePassThroughLayout: log4js.layouts.messagePassThroughLayout
  };

  var fakeConsole = {
    errors: [],
    error: function(msg, value) {
      this.errors.push({ msg: msg, value: value });
    }
  };

  var smtpModule = sandbox.require('../lib/appenders/smtp', {
		requires: {
      'nodemailer': fakeMailer,
      '../layouts': fakeLayouts
		},
    globals: {
      console: fakeConsole
    }
  });

  log4js.setGlobalLogLevel(null);
  log4js.setDefaultLogLevel('TRACE');
  
  log4js.addAppender(smtpModule.configure(options), category);

  console.log("smtp.logger level is ", log4js.getLogger(category).level);
  
  return {
		logger: log4js.getLogger(category),
		mailer: fakeMailer,
    layouts: fakeLayouts,
    console: fakeConsole,
		results: msgs
  };
}

function checkMessages (result, sender, subject) {
  for (var i = 0; i < result.results.length; ++i) {
		assert.equal(result.results[i].from, sender);
		assert.equal(result.results[i].to, 'recipient@domain.com');
		assert.equal(result.results[i].subject, subject ? subject : 'Log event #' + (i+1));
		assert.ok(new RegExp('.+Log event #' + (i+1) + '\n$').test(result.results[i].text));
  }
}

vows.describe('log4js smtpAppender').addBatch({
  'minimal config': {
		topic: function() {
      var setup = setupLogging('minimal config', {
        recipients: 'recipient@domain.com',
        transport: "SMTP",
        SMTP: {
          port: 25,
          auth: {
            user: 'user@domain.com'
          }
        }
      });
      console.log("setup.logger.level is ", setup.logger.level);
      setup.logger.info('Log event #1');
      return setup;
		},
		'there should be one message only': function (result) {
      console.log("smtp.result is ", result);
      assert.equal(result.results.length, 1);
		},
		'message should contain proper data': function (result) {
      checkMessages(result);
		}
  },
  'fancy config': {
    topic: function() {
      var setup = setupLogging('fancy config', {
        recipients: 'recipient@domain.com',
        sender: 'sender@domain.com',
        subject: 'This is subject',
        transport: "SMTP",
        SMTP: {
          port: 25,
          auth: {
            user: 'user@domain.com'
          }
        }
      });
      setup.logger.info('Log event #1');
      return setup;
    },
    'there should be one message only': function (result) {
      assert.equal(result.results.length, 1);
    },
    'message should contain proper data': function (result) {
      checkMessages(result, 'sender@domain.com', 'This is subject');
    }
  },
  'config with layout': {
    topic: function() {
      var setup = setupLogging('config with layout', {
        layout: {
          type: "tester"
        }
      });
      return setup;
    },
    'should configure layout': function(result) {
      assert.equal(result.layouts.type, 'tester');
    }
  },
  'separate email for each event': {
    topic: function() {
      var self = this;
      var setup = setupLogging('separate email for each event', {
        recipients: 'recipient@domain.com',
        transport: "SMTP",
        SMTP: {
          port: 25,
          auth: {
            user: 'user@domain.com'
          }
        }
      });
      setTimeout(function () {
        setup.logger.info('Log event #1');
      }, 0);
      setTimeout(function () {
        setup.logger.info('Log event #2');
      }, 500);
      setTimeout(function () {
        setup.logger.info('Log event #3');
      }, 1050);
      setTimeout(function () {
        self.callback(null, setup);
      }, 2100);
    },
    'there should be three messages': function (result) {
      assert.equal(result.results.length, 3);
    },
    'messages should contain proper data': function (result) {
      checkMessages(result);
    }
  },
  'multiple events in one email': {
    topic: function() {
      var self = this;
      var setup = setupLogging('multiple events in one email', {
        recipients: 'recipient@domain.com',
        sendInterval: 1,
        transport: "SMTP",
        SMTP: {
          port: 25,
          auth: {
            user: 'user@domain.com'
          }
        }
      });
      setTimeout(function () {
        setup.logger.info('Log event #1');
      }, 0);
      setTimeout(function () {
        setup.logger.info('Log event #2');
      }, 500);
      setTimeout(function () {
        setup.logger.info('Log event #3');
      }, 1050);
      setTimeout(function () {
        self.callback(null, setup);
      }, 2100);
    },
    'there should be two messages': function (result) {
      assert.equal(result.results.length, 2);
    },
    'messages should contain proper data': function (result) {
      assert.equal(result.results[0].to, 'recipient@domain.com');
      assert.equal(result.results[0].subject, 'Log event #1');
      assert.equal(result.results[0].text.match(new RegExp('.+Log event #[1-2]$', 'gm')).length, 2);
      assert.equal(result.results[1].to, 'recipient@domain.com');
      assert.equal(result.results[1].subject, 'Log event #3');
      assert.ok(new RegExp('.+Log event #3\n$').test(result.results[1].text));
    }
  },
  'error when sending email': {
    topic: function() {
      var setup = setupLogging('error when sending email', {
        recipients: 'recipient@domain.com',
        sendInterval: 0,
        transport: 'SMTP',
        SMTP: { port: 25, auth: { user: 'user@domain.com' } }
      });

      setup.mailer.createTransport = function() {
        return {
          sendMail: function(msg, cb) {
            cb({ message: "oh noes" });
          },
          close: function() { }
        };
      };
      
      setup.logger.info("This will break");
      return setup.console;
    },
    'should be logged to console': function(cons) {
      assert.equal(cons.errors.length, 1);
      assert.equal(cons.errors[0].msg, "log4js.smtpAppender - Error happened");
      assert.equal(cons.errors[0].value.message, 'oh noes');
    }
  }

}).export(module);

