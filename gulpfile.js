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

var del                = require('del'),
    path               = require('path'),
    gulp               = require('gulp'),
    gutil              = require('gulp-util'),
    concat             = require('gulp-concat'),
    browserSync        = require('browser-sync').create(),
    uglify             = require('gulp-uglify'),
    sass               = require('gulp-sass'),
    postcss            = require('gulp-postcss'),
    assets             = require('postcss-assets'),
    autoprefixer       = require('autoprefixer'),
    file               = require('gulp-file'),
    modernizr          = require('modernizr'),
    sourcemaps         = require('gulp-sourcemaps'),
    notify             = require('gulp-notify'),
    notifier           = require('node-notifier'),
    extend             = require('gulp-extend'),
    jsonlint           = require('gulp-jsonlint'),
    minimist           = require('minimist'),
    gulpif             = require('gulp-if'),
    runSequence        = require('run-sequence'),
    eslint             = require('gulp-eslint'),
    webpack            = require('webpack'),
    ProgressBarPlugin  = require('progress-bar-webpack-plugin'),
    bump               = require('gulp-bump'),
    jeditor            = require('gulp-json-editor'),
    moment             = require('moment'),
    modernConfig       = require('./modernizr-config.json'),
    webpackConfig      = require('./webpack.config.js'),
    myConfig           = Object.create(webpackConfig),

    // get configuration
    config           = require('./config.json'),
    rootFiles        = config.root,
    scssIncludePaths = config.scssIncludePaths,
    cssVendor        = config.cssVendor,

    // parse parameters
    argv = minimist(process.argv.slice(2), { boolean: true });

/**
 *
 *   Build config
 *
 */

var BUILD_DIR = 'dist',
    AUTO_PREFIXER_RULES = ['last 2 versions'];

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
    path: BUILD_DIR + '/assets',
    publicPath: 'assets/', // not using
    filename: '[name].js.liquid',
    sourceMapFilename: '[file].map'
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
        open: 'external',
        host: 'eightcig-2.myshopify.com',
        proxy: 'eightcig-2.myshopify.com', // or project.dev/app/
        port: 443
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
        BUILD_DIR + '/assets/*.js',
        BUILD_DIR + '/assets/*.js.liquid',
        BUILD_DIR + '/assets/*.scss',
        BUILD_DIR + '/assets/*.scss.liquid',
        BUILD_DIR + '/config/*.json',
        BUILD_DIR + '/layout/*.liquid',
        BUILD_DIR + '/locales/*.json',
        BUILD_DIR + '/snippets/*.liquid',
        BUILD_DIR + '/templates/*.liquid'
    ], { force: true });
});

/**
 *
 *   Build tasks
 *
 */

// Build main css
gulp.task('_css-build', function () {
    return gulp.src(['src/scss/**/*.scss', 'src/scss/**/*.scss.liquid'])
        .pipe(gulpif(!argv.dist, sourcemaps.init()))
        .pipe(
            sass({ includePaths: scssIncludePaths })
            .on('error', notify.onError('Error: <%= error.message %>'))
        )
        .pipe(
            gulpif(
                !argv.dist,
                postcss([
                    assets({ basePath: BUILD_DIR }),
                    autoprefixer({ browsers: AUTO_PREFIXER_RULES })
                ])
            )
        )
        .pipe(
            gulpif(
                argv.dist,
                postcss([
                    assets({ basePath: BUILD_DIR }),
                    autoprefixer({ browsers: AUTO_PREFIXER_RULES }),
                    cssnano
                ])
            )
        )
        .pipe(gulpif(!argv.dist, sourcemaps.write('./')))
        .pipe(gulp.dest(BUILD_DIR + '/assets/'))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'CSS build completed.', onLast: true })));
});

// Build vendor css
gulp.task('_css-vendor-build', function () {
    return gulp.src(cssVendor)
        .pipe(gulpif(!argv.dist, sourcemaps.init()))
        .pipe(concat('vendor.css'))
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
        .pipe(gulpif(!argv.dist, sourcemaps.write('./')))
        .pipe(gulp.dest(BUILD_DIR + '/assets/'))
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
        runSequence('_js-lint', function () {
            webpackCb(err, stats);
        });
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
    modernizr.build(modernConfig, function (result) {
        MODERNIZR_LIB = result;

        cb();
    });
});

gulp.task('_modernizr-build', ['_modernizr-generate'], function () {
    return file('modernizr.js', MODERNIZR_LIB, { src: true })
        .pipe(gulpif(argv.dist, uglify()))
        .pipe(gulp.dest(BUILD_DIR + '/assets/'));
});

// Copy snippets
gulp.task('_snippets-build', function () {
    return gulp.src('src/snippets/**/*.liquid')
        .pipe(gulp.dest(BUILD_DIR + '/snippets/'))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Snippets build completed.', onLast: true })));
});

// Copy templates
gulp.task('_templates-build', function () {
    return gulp.src('src/templates/**/*.liquid')
        .pipe(gulp.dest(BUILD_DIR + '/templates/'))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Template build completed.', onLast: true })));
});

// Copy layout
gulp.task('_layout-build', function () {
    return gulp.src('src/layout/**/*.liquid')
        .pipe(gulp.dest(BUILD_DIR + '/layout/'))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Layout build completed.', onLast: true })));
});

// Copy root files
gulp.task('_root-files-build', function () {
    return gulp.src(rootFiles)
        .pipe(gulp.dest(BUILD_DIR + '/'))
        .pipe(gulpif(LIVE_RELOAD, browserSync.stream()))
        .pipe(gulpif(TASK_NOTIFICATION, notify({ message: 'Root files build completed.', onLast: true })));
});

/**
 *
 *   ESLint task
 *
 */

gulp.task('_js-lint', function () {
    return gulp.src(['src/scripts/**/*.js', 'src/scripts/**/*.js.liquid'])
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.results(function (results) {
            if (results.errorCount === 0 && results.warningCount === 0) {
                return;
            }

            notifier.notify({
                title: 'Error running Gulp',
                message: 'JavaScript ESLint error.',
                icon: path.join(__dirname, 'node_modules', 'gulp-notify', 'assets', 'gulp-error.png'),
                sound: 'Frog'
            });
        }));
});

/**
 *
 *   Main build task
 *
 */

gulp.task('_build', ['_css-build', '_css-vendor-build', '_snippets-build',
    '_templates-build', '_layout-build', '_modernizr-build',
    '_root-files-build', '_data-build'], function () {
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

    gulp.watch('src/snippets/**/*.liquid', ['_snippets-build']);

    gulp.watch('src/templates/**/*.liquid', ['_templates-build']);

    gulp.watch('src/layout/**/*.liquid', ['_layout-build']);

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
