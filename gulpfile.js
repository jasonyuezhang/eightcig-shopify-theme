'use strict';

/**
 *
 *      gulp build        - build for development
 *      gulp watch        - build and watch files for change
 *      gulp              - default task [watch]
 *      gulp build --dist - build for production
 *      gulp browser-sync - create http server for testing
 *      gulp bump --major - bump major version
 *      gulp bump --minor - bump minor version
 *      gulp bump --patch - bump patch version
 *
 */

var fs                 = require('fs'),
    del                = require('del'),
    junk               = require('junk'),
    path               = require('path'),
    gulp               = require('gulp'),
    gutil              = require('gulp-util'),
    concat             = require('gulp-concat'),
    uglify             = require('gulp-uglify'),
    shell              = require('gulp-shell'),
    filter             = require('gulp-filter'),
    shopifyUpload      = require('gulp-shopify-upload'),
    autoprefixer       = require('autoprefixer'),
    file               = require('gulp-file'),
    modernizr          = require('modernizr'),
    notify             = require('gulp-notify'),
    notifier           = require('node-notifier'),
    minimist           = require('minimist'),
    gulpif             = require('gulp-if'),
    changed            = require('gulp-changed'),
    runSequence        = require('run-sequence'),
    webpack            = require('webpack'),
    ProgressBarPlugin  = require('progress-bar-webpack-plugin'),
    bump               = require('gulp-bump'),
    jeditor            = require('gulp-json-editor'),
    rename             = require('gulp-rename'),
    moment             = require('moment'),

    // stylesheets related
    bourbon            = require('node-bourbon'),
    assets             = require('postcss-assets'),
    cssnano            = require('cssnano'),
    shopifySass        = require('gulp-shopify-sass'),
    postcss            = require('gulp-postcss'),

    // Automatic broswer refresh
    browserSync        = require('browser-sync').create(),

    // get configuration
    config           = require('./config.json'),
    rootFiles        = config.root,
    modernizrConfig  = config.modernizrConfig,
    cssVendor        = config.cssVendor,
    cssExt           = config.cssExt,
    cssOrderConfig   = 'order.json',
    cssOrder,        // assigned by _css-list task
    shopifyUrl       = config.shopifyUrl,
    webpackConfig    = require('./webpack.config.js'),
    myConfig         = Object.create(webpackConfig),

    // parse parameters
    argv = minimist(process.argv.slice(2), { boolean: true });

/**
 *
 *   Build config
 *
 */

var SRC_DIR             = config.srcRoot,
    SCSS_DIR            = config.scssRoot,
    SCRIPT_DIR          = config.scriptRoot,
    BUILD_DIR           = config.buildRoot,
    ASSETS_DIR          = config.assetsRoot,

    AUTO_PREFIXER_RULES = ['last 2 versions'];

/**
 *
 *   Shopify config
 *
 */

var shopifyConfig = config.shopify;

/**
 *
 *   Helper variables
 *
 */

var TASK_NOTIFICATION = false,
    LIVE_RELOAD = false,
    MODERNIZR_LIB,
    BUMP_TYPE;

/**
 *
 *   Webpack config
 *
 */

myConfig.output = {
    path: ASSETS_DIR,
    publicPath: 'assets/', // not using
    filename: '[name].js.liquid'
};

myConfig.plugins = [
    new ProgressBarPlugin()
];

if (argv.dist) {
    myConfig.plugins.push(new webpack.optimize.UglifyJsPlugin());
} else {
    myConfig.debug = true;
    myConfig.devtool = '#cheap-module-source-map';
}

/**
 *
 *  Server
 *
 */

gulp.task('browser-sync', function () {
    browserSync.init({
        proxy: shopifyConfig.reload_url,
        browser: 'google chrome',
        injectChanges: false // cause of css being served from cdn
    });
});

/**
 *
 *   Bump version
 *
 */

gulp.task('bump', function (cb) {
    if (argv.major) {
        BUMP_TYPE = 'major';
    } else if (argv.minor) {
        BUMP_TYPE = 'minor';
    } else if (argv.patch) {
        BUMP_TYPE = 'patch';
    } else {
        cb();
        gutil.log(gutil.colors.blue('Specify valid semver version type to bump!'));
        return;
    }

    runSequence('_version-timestamp', '_version-bump', cb);
});

gulp.task('_version-timestamp', function () {
    return gulp.src('./src/scripts/data/version.json')
        .pipe(jeditor({ 'time': moment().format('DD.MM.YYYY HH:mm:ss (ZZ)') }))
        .pipe(gulp.dest('./src/scripts/data/'));
});

gulp.task('_version-bump', function () {
    return gulp.src([
        './bower.json',
        './package.json',
        './test/package.json',
        './src/scripts/data/version.json'
    ], { base: './' })
        .pipe(bump({ type: BUMP_TYPE }))
        .pipe(gulp.dest('./'));
});

/**
 *
 *   Clean task
 *
 */

gulp.task('_clean', function () {
    return del([
        path.join(ASSETS_DIR, '*.js'),
        path.join(ASSETS_DIR, '*.js.liquid'),
        path.join(ASSETS_DIR, '*.scss'),
        path.join(ASSETS_DIR, '*.scss.liquid'),
        path.join(BUILD_DIR, 'config/*.json'),
        path.join(BUILD_DIR, 'layout/**/*.liquid'),
        path.join(BUILD_DIR, 'locales/*.json'),
        path.join(BUILD_DIR, 'snippets/**/*.liquid'),
        path.join(BUILD_DIR, 'templates/**/*.liquid')
    ], { force: true });
});

/**
 *
 *   Build tasks
 *
 */

var upload = function upload () {
    return shopifyUpload(shopifyConfig.api_key, shopifyConfig.password, shopifyConfig.store, shopifyConfig.theme_id, shopifyConfig.options);
}

// Build main css
gulp.task('_css-build', function () {
    return gulp.src(path.join(__dirname, SCSS_DIR, 'styles.scss'))
        .pipe(shopifySass())
        .pipe(gulp.dest(ASSETS_DIR))
        .pipe(upload())
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'CSS build completed.', onLast: true })));
});

// Build vendor css
gulp.task('_css-vendor-build', function () {
    return gulp.src(cssVendor)
        .pipe(concat('vender.css'))
        .pipe(
            gulpif(
                !argv.dist,
                postcss([
                    autoprefixer({ browsers: AUTO_PREFIXER_RULES })
                ])
            )
        )
        .pipe(
            gulpif(
                argv.dist,
                postcss([
                    autoprefixer({ browsers: AUTO_PREFIXER_RULES }),
                    cssnano
                ])
            )
        )
        .pipe(gulp.dest(ASSETS_DIR))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Vendor CSS build completed.', onLast: true })));
});

// Build js files
var createWebpackCb = function (cb) {
    var calledOnce = false;

    var webpackCb = function (err, stats) {
        if (err) {
            throw new gutil.PluginError('webpack', err);
        }

        gutil.log('[webpack]', stats.toString({ chunks: false, colors: true }));

        if (stats.hasErrors()) {
            if (!TASK_NOTIFICATION) {
                throw new gutil.PluginError('webpack', new Error('JavaScript build error.'));
            } else {
                notifier.notify({
                    title: 'Error running Gulp',
                    message: 'JavaScript build error.',
                    icon: path.join(__dirname, 'node_modules', 'gulp-notify', 'assets', 'gulp-error.png'),
                    sound: 'Frog'
                });
                gutil.log(
                    gutil.colors.cyan('gulp-notify:'),
                    gutil.colors.blue('[Error running Gulp]'),
                    gutil.colors.green('JavaScript build error.')
                );
                gutil.log(
                    gutil.colors.white('Finished'),
                    gutil.colors.cyan('\'_js-watch\''),
                    gutil.colors.white('after'),
                    gutil.colors.magenta(stats.toJson().time + ' ms')
                );
            }
        } else {
            if (TASK_NOTIFICATION) {
                notifier.notify({
                    title: 'Gulp notification',
                    message: 'JavaScript build completed.',
                    icon: path.join(__dirname, 'node_modules', 'gulp-notify', 'assets', 'gulp.png')
                });
                gutil.log(
                    gutil.colors.cyan('gulp-notify:'),
                    gutil.colors.blue('[Gulp notification]'),
                    gutil.colors.green('JavaScript build completed.')
                );
                gutil.log(
                    gutil.colors.white('Finished'),
                    gutil.colors.cyan('\'_js-watch\''),
                    gutil.colors.white('after'),
                    gutil.colors.magenta(stats.toJson().time + ' ms')
                );
            }

            if (LIVE_RELOAD) {
                browserSync.reload();
            }
        }

        if (!calledOnce) {
            calledOnce = true;
            cb();
        }
    };

    return function (err, stats) {
        webpackCb(err, stats);
    };
};

var compiler = webpack(myConfig);

gulp.task('_js-build', function (cb) {
    compiler.run(createWebpackCb(cb));
});

gulp.task('_js-watch', function (cb) {
    compiler.watch({}, createWebpackCb(cb));
});

// Build modernizr js
gulp.task('_modernizr-generate', function (cb) {
    modernizr.build(modernizrConfig, function (result) {
        MODERNIZR_LIB = result;

        cb();
    });
});

// Copy files to distination
gulp.task('_file-copy', function () {
    return gulp.src(['src/**/*.liquid', 'src/**/*.json', '!src/scss/**/*.*', '!src/scripts/**/*.*'])
        .pipe(changed(BUILD_DIR))
        .pipe(gulp.dest(BUILD_DIR))
        .pipe(upload())
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Files copy completed.', onLast: true })));
});

gulp.task('_modernizr-build', ['_modernizr-generate'], function () {
    return file('modernizr.js', MODERNIZR_LIB, { src: true })
        .pipe(gulpif(argv.dist, uglify()))
        .pipe(gulp.dest(ASSETS_DIR));
});

// Copy root files
gulp.task('_root-files-copy', function () {
    return gulp.src(rootFiles)
        .pipe(changed(BUILD_DIR))
        .pipe(gulp.dest(BUILD_DIR))
        .pipe(upload())
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Root files copy completed.', onLast: true })));
});

/**
 *
 *   Main build task
 *
 */

gulp.task('_build', ['_css-build', '_css-vendor-build', '_modernizr-build',
    '_file-copy', '_root-files-copy'], function () {
    notifier.notify({
        title: 'Gulp notification',
        message: 'Build completed.',
        icon: path.join(__dirname, 'node_modules', 'gulp-notify', 'assets', 'gulp.png')
    });
});

gulp.task('build', function (cb) {
    runSequence('_clean', '_js-build', '_build', cb);
});

/**
 *
 *   Watch task
 *
 */

gulp.task('_watch', function () {
    gulp.watch(['src/scss/**/*.scss', 'src/scss/**/*.scss.liquid'], ['_css-build']);

    gulp.watch(['src/**/*.liquid', 'src/**/*.json', '!src/scss/**/*.*', '!src/scripts/**/*.*'], ['_file-copy']);

    gulp.watch(rootFiles, ['_root-files-build']);
});

gulp.task('watch', function (cb) {
    runSequence('_clean', '_js-watch', '_build', '_watch', 'browser-sync', function () {
        TASK_NOTIFICATION = true;
        LIVE_RELOAD = true;

        cb();
    });
});

/**
 *
 *   Set DEFAULT task
 *
 */

gulp.task('default', ['watch']);
