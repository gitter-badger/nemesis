'use strict';

var async = require('async');
var nconf = require('nconf');

var user = require('../user');
var meta = require('../meta');
var plugins = require('../plugins');
var navigation = require('../navigation');
var translator = require('../../public/src/modules/translator');

var controllers = {
	api: require('../controllers/api'),
	helpers: require('../controllers/helpers')
};

module.exports = function(app, middleware) {

	middleware.buildHeader = function(req, res, next) {
		res.locals.renderHeader = true;
		res.locals.isAPI = false;

		middleware.applyCSRF(req, res, function() {
			async.parallel({
				config: function(next) {
					controllers.api.getConfig(req, res, next);
				},
				footer: function(next) {
					app.render('footer', {loggedIn: (req.user ? parseInt(req.user.uid, 10) !== 0 : false)}, next);
				},
				plugins: function(next) {
					plugins.fireHook('filter:middleware.buildHeader', {req: req, locals: res.locals}, next);
				}
			}, function(err, results) {
				if (err) {
					return next(err);
				}

				res.locals.config = results.config;

				translator.translate(results.footer, results.config.defaultLang, function(parsedTemplate) {
					res.locals.footer = parsedTemplate;
					next();
				});
			});
		});
	};

	middleware.renderHeader = function(req, res, data, callback) {
		var registrationType = meta.config.registrationType || 'normal';
		var templateValues = {
			bootswatchCSS: meta.config['theme:src'],
			title: meta.config.title || '',
			description: meta.config.description || '',
			'cache-buster': meta.config['cache-buster'] ? 'v=' + meta.config['cache-buster'] : '',
			'brand:logo': meta.config['brand:logo'] || '',
			'brand:logo:url': meta.config['brand:logo:url'] || '',
			'brand:logo:alt': meta.config['brand:logo:alt'] || '',
			'brand:logo:display': meta.config['brand:logo']?'':'hide',
			allowRegistration: registrationType === 'normal' || registrationType === 'admin-approval',
			searchEnabled: plugins.hasListeners('filter:search.query'),
			config: res.locals.config,
			relative_path: nconf.get('relative_path'),
			bodyClass: data.bodyClass
		};

		templateValues.configJSON = JSON.stringify(res.locals.config);

		async.parallel({
			settings: function(next) {
				if (req.uid) {
					user.getSettings(req.uid, next);
				} else {
					next();
				}
			},
			isAdmin: function(next) {
				user.isAdministrator(req.uid, next);
			},
			user: function(next) {
				if (req.uid) {
					user.getUserFields(req.uid, ['username', 'userslug', 'email', 'picture', 'status', 'email:confirmed', 'banned'], next);
				} else {
					next(null, {
						username: '[[global:guest]]',
						userslug: '',
						picture: user.createGravatarURLFromEmail(''),
						status: 'offline',
						banned: false,
						uid: 0
					});
				}
			},
			navigation: async.apply(navigation.get),
			tags: async.apply(meta.tags.parse, res.locals.metaTags, res.locals.linkTags)
		}, function(err, results) {
			if (err) {
				return callback(err);
			}

			if (results.user && parseInt(results.user.banned, 10) === 1) {
				req.logout();
				return res.redirect('/');
			}

			results.user.isAdmin = results.isAdmin;
			results.user.uid = parseInt(results.user.uid, 10);
			results.user['email:confirmed'] = parseInt(results.user['email:confirmed'], 10) === 1;

			if (results.settings && results.settings.bootswatchSkin && results.settings.bootswatchSkin !== 'default') {
				templateValues.bootswatchCSS = '//maxcdn.bootstrapcdn.com/bootswatch/latest/' + results.settings.bootswatchSkin + '/bootstrap.min.css';
			}

			templateValues.browserTitle = controllers.helpers.buildTitle(data.title);
			templateValues.navigation = results.navigation;
			templateValues.metaTags = results.tags.meta;
			templateValues.linkTags = results.tags.link;
			templateValues.isAdmin = results.user.isAdmin;
			templateValues.user = results.user;
			templateValues.userJSON = JSON.stringify(results.user);
			templateValues.useCustomCSS = parseInt(meta.config.useCustomCSS, 10) === 1 && meta.config.customCSS;
			templateValues.customCSS = templateValues.useCustomCSS ? (meta.config.renderedCustomCSS || '') : '';
			templateValues.useCustomJS = parseInt(meta.config.useCustomJS, 10) === 1;
			templateValues.customJS = templateValues.useCustomJS ? meta.config.customJS : '';
			templateValues.maintenanceHeader = parseInt(meta.config.maintenanceMode, 10) === 1 && !results.isAdmin;
			templateValues.defaultLang = meta.config.defaultLang || 'en_GB';

			templateValues.template = {name: res.locals.template};
			templateValues.template[res.locals.template] = true;

			if (req.route && req.route.path === '/') {
				modifyTitle(templateValues);
			}

			plugins.fireHook('filter:middleware.renderHeader', {templateValues: templateValues, req: req, res: res}, function(err, data) {
				if (err) {
					return callback(err);
				}

				app.render('header', data.templateValues, callback);
			});
		});
	};


	function modifyTitle(obj) {
		var title = controllers.helpers.buildTitle('[[pages:home]]');
		obj.browserTitle = title;

		if (obj.metaTags) {
			obj.metaTags.forEach(function(tag, i) {
				if (tag.property === 'og:title') {
					obj.metaTags[i].content = title;
				}
			});
		}

		return title;
	}

};



