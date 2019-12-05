/* eslint-disable prefer-object-spread */
const path = require('path');
const Jimp = require('jimp');
const _fs = require('fs'); // eslint-disable-line no-underscore-dangle
const _mkdirp = require('mkdirp'); // eslint-disable-line no-underscore-dangle
const { promisifyAll } = require('bluebird');
const { isArray } = require('lodash');
const GIFEncoder = require('gifencoder');

const { createImage } = require('./Image');
const { constructAnimationFrames, readCggFile } = require('./DataProcessor');

const fs = promisifyAll(_fs);
const mkdirp = promisifyAll(_mkdirp);

const processArguments = function (...args) {
    return args.reduce((options, arg, index) => {
        switch (arg) {
        case '-a':
            return Object.assign({}, options, { animName: args[index + 1] });
        case '-c':
            return Object.assign({}, options, { columns: parseInt(args[index + 1], 10) });
        case '-e':
            return Object.assign({}, options, { includeEmpty: true });
        case '-i':
            return Object.assign({}, options, { inputPath: args[index + 1] });
        case '-o':
            return Object.assign({}, options, { outputPath: args[index + 1] });
        case '-v':
            return Object.assign({}, options, { verbose: true });
        case '-j':
            return Object.assign({}, options, { saveJson: true });
        case '-g':
            return Object.assign({}, options, { outputGif: true });
        default:
            return options;
        }
    });
};

const defaultOptions = {
    id: -1, // {number} the unitId
    animName: '', // {string} animation name
    cggPath: null, // {string} full path to the cgg file
    columns: 0, // {number} columns in sheet or strip
    inputPath: '.', // {string} source file(s) path
    outputPath: '.', // {string} output path
    includeEmpty: false, // {boolean} determines whether to include empty frames
    verbose: false, // {boolean} determines logging verbosity
    saveJson: false, // {boolean} determines whether to output json file
    outputGif: false, // {boolean} determines whether to output animated gif
};

/**
 * Takes the data and writes the image and json data to file
 * @param {Object} params Parameters object containing the data to write to file
 * @param {Object} options The command options
 * @returns {string} The result message
 */
const saveFile = async function ({ cgsPath, json, image }, { saveJson, outputPath }) {
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `${ action }_${ uid }`;
    const imagePath = path.join(outputPath, `${ filename }.png`);
    const jsonPath = path.join(outputPath, `${ filename }.json`);

    console.info(` * * Saving [${ imagePath }]`);

    const resolution = {};
    try {
        await image.write(imagePath);
        resolution.imageSave = ` * * Successfully saved [${ imagePath }]`;
    } catch (error) {
        resolution.imageSave = error;
    }

    if (saveJson) {
        try {
            await fs.writeFileAsync(jsonPath, JSON.stringify(json));
            resolution.jsonSave = ` * * Successfully saved [${ jsonPath }]`;
        } catch (error) {
            resolution.jsonSave = error;
        }
    }

    return resolution;
};

/**
 * Composites all the frames into an animated gif
 *
 * @param {Object} framesData The object data containing all frame information
 * @param {Array} framesData.frames The list of frame images
 * @param {Object} framesData.dimensions The object containing the frame Rect
 * @param {number|Array} framesData.delays The delay between each frames
 * @param {string} framesData.cgsPath The path to the cgs data file
 * @param {Object} options The command options
 */
const encodeAnimatedGif = function ({
    frames = [],
    dimensions = {},
    delays = 500,
    cgsPath = '',
}, options = {}) {
    const { outputPath } = options;
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `${ action }_${ uid }`;
    const imagePath = path.join(outputPath, `${ filename }.gif`);

    console.info(` * * Saving Animated Gif: [${ imagePath }]`);

    const {
        x,
        y,
        width,
        height,
    } = dimensions;
    const encoder = new GIFEncoder(width, height);
    encoder.createReadStream().pipe(fs.createWriteStream(imagePath));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setTransparent(0xFFFFFF);

    frames.forEach((frame, index) => {
        const frameDelay = typeof delays === 'number' ? delays : delays[index];
        encoder.setDelay((frameDelay / 60) * 1000);
        encoder.addFrame(frame.clone().crop(x, y, width, height).bitmap.data);
    });

    encoder.finish();
    console.info(` * * Successfully saved [${ imagePath }]`);
};

/**
 * Takes the cgs data and frame information along with the source image to composite
 * each frame onto the final sprite sheet
 * @param {string} cgsPath Path to the cgs file
 * @param {array} frames The array of frame objects
 * @param {Jimp} image The source image
 * @param {Object} options The command options
 * @returns {Promise} Resolves to object containing the output image and json data
 */
const makeStrip = async function (cgsPath, frames, image, options) {
    console.info(' --- Making Animation Sheet');
    const { columns, outputPath } = options;

    console.info(`\tcgsPath [${ cgsPath }]`);
    const data = await fs.readFileAsync(cgsPath, 'utf8');
    const lines = data.replace('\r').split('\n').map((line) => line.split(',').slice(0, -1));
    const {
        frameImages,
        frameDelays,
        topLeft,
        bottomRight,
    } = await constructAnimationFrames(lines, frames, image, options);

    console.info(' * * DONE processing cgs Data ');
    console.info(JSON.stringify(topLeft, null, 2));
    const frameRect = {
        x: topLeft.x - 5,
        y: topLeft.y - 5,
        width: (bottomRight.x - topLeft.x) + 10,
        height: (bottomRight.y - topLeft.y) + 10,
    };

    const json = {
        frameDelays,
        frameRect,
    };

    if (options.outputGif) {
        encodeAnimatedGif({
            frames: frameImages,
            dimensions: frameRect,
            delays: frameDelays,
            cgsPath,
        }, options);
    }

    const output = {
        cgsPath,
        json,
    };

    if (columns === 0 || columns >= frameImages.length) {
        // animation strip
        json.imageWidth = frameImages.length * frameRect.width;
        json.imageHeight = frameRect.height;

        const img = await createImage(frameImages.length * frameRect.width, frameRect.height);
        const sheet = frameImages.reduce((compositeImage, frameObject, index) => {
            const {
                x,
                y,
                width,
                height,
            } = frameRect;
            frameObject.crop(x, y, width, height);

            return compositeImage.composite(frameObject, index * width, 0);
        }, img);

        output.image = sheet;
    } else {
        // animation sheet
        const rows = Math.ceil(frameImages.length / columns);
        json.imageWidth = columns * frameRect.width;
        json.imageHeight = rows * frameRect.height;
        const img = await createImage(columns * frameRect.width, rows * frameRect.height);
        const sheet = frameImages.reduce((compositeImage, frameObject, index) => {
            const {
                x,
                y,
                width,
                height,
            } = frameRect;
            const row = Math.floor(index / columns);
            const col = index % columns;

            frameObject.crop(x, y, width, height);
            return compositeImage.composite(frameObject, col * width, row * height);
        }, img);

        output.image = sheet;
    }

    if (outputPath !== '.') {
        await mkdirp.mkdirpAsync(outputPath);
    }

    return output;
};

/**
 * Reads the source png image
 *
 * @param {Object} unit - An object describing a single character unit
 * @param {string} unit.unitId - The unit's id
 * @param {array} unit.frames - The unit's animation frames
 * @param {Object} options - The command options
 * @param {string} options.inputPath - The file input path
 * @return {Promise} - Resolves to the source image as Jimp
 */
const readSource = function ({ unitId }, { inputPath }) {
    console.info(' --- Read Source Image');
    const sourceImagePath = path.join(inputPath, `unit_anime_${ unitId }.png`);

    console.info(`\tsourceImagePath: [${ sourceImagePath }]`);
    return Jimp.read(sourceImagePath);
};

/**
 * Composites all the frames onto a single image sheet.
 * @param {Jimp} image The image canvas
 * @param {Object} unit The unit object
 * @param {number} unit.unitId The unit's id
 * @param {Array} frames The array of frame objects
 * @param {Object} options The application options
 * @returns {Promise} Resolves to an object containing the image and json data
 */
const buildSheet = function (image, { unitId, frames }, options) {
    const { animName, inputPath } = options;

    if (animName) {
        console.info(' --- Building single sheet');
        const cgsPath = path.join(inputPath, `unit_${ animName }_cgs_${ unitId }.csv`);

        return makeStrip(cgsPath, frames, image, options);
    }

    console.info(' --- Building all sheets in directory');

    return fs.readdirAsync(inputPath)
        .then((files) => Promise.all(files.map((file) => {
            if (file.search(/^(unit_).+_cgs_\d+(\.csv)$/) > -1 && file.indexOf(unitId) > -1) {
                const cgsPath = path.join(inputPath, file);
                return makeStrip(cgsPath, frames, image, options);
            }

            return null;
        })));
};

const usage = `Usage: ffbetool num [-a anim] [-c columns] [-e] [-v] [-j] [-g] [-i inDir] [-o outDir]
    num: The unit id
    [-i]: The source input directory
    [-o]: The output directory
    [-a]: The animation name
    [-c]: The number of columns
    [-e]: Include empty frames
    [-v]: Verbose logs
    [-j]: Save json file
    [-g]: Save animated gif
`;

// entry point
const main = (options) => {
    const { id } = options;

    if (!id || Number.isNaN(id) || id < 0) {
        console.info(usage);
        return;
    }

    readCggFile(id, options)
        .then((unit) => Promise.all([unit, readSource(unit, options)]))
        .then(([unit, image]) => buildSheet(image, unit, options))
        .then(async (output) => {
            if (isArray(output)) {
                return output
                    .filter((onefile) => onefile !== null)
                    .map((saveInfo) => saveFile(saveInfo, options));
            }

            return [await saveFile(output, options)];
        })
        .then((res) => {
            res.forEach(({ imageSave, jsonSave }) => {
                console.info(imageSave);

                if (jsonSave) {
                    console.info(jsonSave);
                }
            });
        })
        .catch((error) => {
            console.error(error);
        });
};

module.exports = main;
// export default main;

if (require.main === module) {
    main(Object.assign(
        {},
        defaultOptions,
        processArguments(...process.argv),
        { id: parseInt(process.argv[2], 10) },
    ));
}
