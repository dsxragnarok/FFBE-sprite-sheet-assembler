const path = require('path');
const Jimp = require('jimp');
const _fs = require('fs');          // eslint-disable-line no-underscore-dangle
const _mkdirp = require('mkdirp');  // eslint-disable-line no-underscore-dangle
const { promisifyAll } = require('bluebird');
const { chunk, isArray } = require('lodash');
const GIFEncoder = require('gifencoder');

const { createImage, blend, getColorBoundsRect } = require('./Image');

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
    id: -1,                 // {number} the unitId
    animName: '',           // {string} animation name
    columns: 0,             // {number} columns in sheet or strip
    inputPath: '.',         // {string} source file(s) path
    outputPath: '.',        // {string} output path
    includeEmpty: false,    // {boolean} determines whether to include empty frames
    verbose: false,         // {boolean} determines logging verbosity
    saveJson: false,        // {boolean} determines whether to output json file
    outputGif: false,       // {boolean} determines whether to output animated gif
};

/**
 * Processes a row of from cgg data to get an array of parts that make up a frame
 *
 * @param {array} data  The array of parameters
 * @param {number} row  The row index of the cgg data
 * @return {Promise} Promise resolving to an array of all the parts that make up this frame
 */
const processCggRowData = function (data, row) {
    const params = data.split(',').slice(0, -1);
    const { length } = params;

    if (length < 2) {
        return null;
    }

    const [anchor, count, ...rest] = params;

    return chunk(rest, rest.length / count)
        .map((config, index) => {
            const [
                xPos,
                yPos,
                nextType,
                blendMode,
                opacity,
                rotate,
                imgX,
                imgY,
                imgWidth,
                imgHeight,
                pageID,
            ] = config;

            return {
                anchor: parseInt(anchor, 10),
                xPos: parseInt(xPos, 10),
                yPos: parseInt(yPos, 10),
                nextType: parseInt(nextType, 10),
                blendMode: parseInt(blendMode, 10),
                opacity: parseInt(opacity, 10),
                rotate: parseInt(rotate, 10),
                imgX: parseInt(imgX, 10),
                imgY: parseInt(imgY, 10),
                imgWidth: parseInt(imgWidth, 10),
                imgHeight: parseInt(imgHeight, 10),
                pageID: parseInt(pageID, 10),
                index,
                flipX: parseInt(nextType, 10) === 1 || parseInt(nextType, 10) === 3,
                flipY: parseInt(nextType, 10) === 2 || parseInt(nextType, 10) === 3,
                lineIndex: row,
            };
        })
        .reverse();
};

/**
 * Reads the cgg file and returns the data composing each frame
 *
 * @param {number} unitId   The unit's id
 * @param {object} options  The options
 * @param {string} options.inputPath    The source input path, defaults to '.'
 * @return {Promise} The Promise resolving to an object containing unitId and
 *                   the animation frames' data
 */
const processCggFile = function (unitId, { inputPath }) {
    console.info(' --- Processing Cgg File');
    const { readFileAsync } = fs;
    const cggPath = path.join(inputPath, `unit_cgg_${ unitId }.csv`);

    console.info(`\tLoading [${ cggPath }]`);

    return readFileAsync(cggPath, 'utf8')
        .then((data) => data.replace('\r').split('\n'))
        .then((data) => data.map(processCggRowData))
        .then((frames) => ({ unitId, frames }));
};

/**
 * Takes the data and writes the image and json data to file
 * @param {Object} params Parameters object containing the data to write to file
 * @param {Object} options The command options
 * @returns {string} The result message
 */
const saveFile = function ({ cgsPath, json, image }, { saveJson, outputPath }) {
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `${ action }_${ uid }`;
    const imagePath = path.join(outputPath, `${ filename }.png`);
    const jsonPath = path.join(outputPath, `${ filename }.json`);

    console.info(` * * Saving [${ imagePath }]`);
    const resolution = {
        imageSave: image.then((img) => img.write(imagePath))
            .then(() => ` * * Successfully saved [${ imagePath }]`)
            .catch((error) => error),
    };

    if (saveJson) {
        resolution.jsonSave = fs.writeFileAsync(jsonPath, JSON.stringify(json))
            .then(() => ` * * Successfully saved [${ jsonPath }]`)
            .catch((error) => error);
    }

    return resolution;
};

/**
 * Processes the cgs data row by row to extract the relevant frame image information
 * @param {array} rows An array containing the rows of data from cgs file
 * @param {array} frames An array of frame objects defining each frame and its images
 * @param {Jimp} sourceImage The source image
 * @param {Object} options The command options
 * @returns {Promise} Resolves to an object containing all the frame images and data for
 *                      compositing the final image sheet
 */
const processCgsData = function (rows, frames, sourceImage, { includeEmpty }) {
    console.info(' --- Process Cgs Data');

    return Promise.all(rows.map((params) => {
        if (params.length < 2) {
            return null;
        }

        const [frameIndex, x, y, delay] = params;
        return createImage(2000, 2000)
            .then((blankImage) => frames[frameIndex].reduce((compositeImage, part) => {
                const { imgX, imgY, imgWidth, imgHeight } = part;
                let crop = sourceImage.clone().crop(imgX, imgY, imgWidth, imgHeight);

                const {
                    xPos,
                    yPos,
                    blendMode,
                    flipX,
                    flipY,
                    rotate,
                    opacity,
                } = part;

                if (blendMode === 1) {
                    crop = blend(crop);
                }

                if (flipX || flipY) {
                    crop.flip(flipX, flipY);
                }

                if (rotate !== 0) {
                    crop.rotate(-1 * rotate, true);
                }

                if (opacity < 100) {
                    crop.opacity(opacity / 100);
                }

                return compositeImage
                    .composite(crop,
                        (2000 / 2) + parseInt(x, 10) + xPos,
                        (2000 / 2) + parseInt(y, 10) + yPos);
            }, blankImage))
            .then((compositeImage) => {
                const rect = getColorBoundsRect(compositeImage, 0xFF000000, 0, false);
                if ((rect.width > 0 && rect.height > 0) || includeEmpty) {
                    return {
                        rect,
                        compositeImage,
                        delay,
                    };
                }

                return null;
            })
            .catch((error) => {
                console.error(error);
                return null;
            });
    }))   // end lines.map
    .then((frameObjects) => frameObjects.reduce((animObject, frame) => {
        if (!frame) {
            return animObject;
        }

        const { frameImages, frameDelays } = animObject;
        const { compositeImage = null, rect = null, delay } = frame;
        let { topLeft, bottomRight } = animObject;

        if (!compositeImage || !rect) {
            return animObject;
        }

        frameImages.push(compositeImage);
        frameDelays.push(delay);
        if (rect && topLeft === null) {
            const { x, y, width, height } = rect;
            topLeft = { x, y };
            bottomRight = { x: x + width, y: y + height };
        } else if (rect) {
            const { x, y, width, height } = rect;
            topLeft = {
                x: Math.min(x, topLeft.x),
                y: Math.min(y, topLeft.y),
            };
            bottomRight = {
                x: Math.max(x + width, bottomRight.x),
                y: Math.max(y + height, bottomRight.y),
            };
        }

        return { frameImages, frameDelays, topLeft, bottomRight };
    }, { frameImages: [], frameDelays: [], topLeft: null, bottomRight: null }));
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
},
    options = {},
) {
    const { outputPath } = options;
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `${ action }_${ uid }`;
    const imagePath = path.join(outputPath, `${ filename }.gif`);

    console.info(` * * Saving Animated Gif: [${ imagePath }]`);

    const { x, y, width, height } = dimensions;
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
const makeStrip = function (cgsPath, frames, image, options) {
    console.info(' --- Making Animation Sheet');
    const { columns, outputPath } = options;

    console.info(`\tcgsPath [${ cgsPath }]`);
    return fs.readFileAsync(cgsPath, 'utf8')
        .then((data) => data.replace('\r').split('\n'))
        .then((lines) => lines.map((line) => line.split(',').slice(0, -1)))
        .then((lines) => processCgsData(lines, frames, image, options))
        .then((imageObject) => {
            console.info(' * * DONE processing cgs Data ');
            const { frameImages, frameDelays, topLeft, bottomRight } = imageObject;

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

            if (columns === 0 || columns >= frameImages.length) {
                // animation strip
                json.imageWidth = frameImages.length * frameRect.width;
                json.imageHeight = frameRect.height;

                const sheet = createImage(frameImages.length * frameRect.width, frameRect.height)
                    .then((img) => frameImages.reduce((compositeImage, frameObject, index) => {
                        const { x, y, width, height } = frameRect;
                        frameObject.crop(x, y, width, height);

                        return compositeImage.composite(frameObject, index * width, 0);
                    }, img));

                return { sheet, json };
            }

            // animation sheet
            const rows = Math.ceil(frameImages.length / columns);
            json.imageWidth = columns * frameRect.width;
            json.imageHeight = rows * frameRect.height;
            const sheet = createImage(columns * frameRect.width, rows * frameRect.height)
                .then((img) => frameImages.reduce((compositeImage, frameObject, index) => {
                    const { x, y, width, height } = frameRect;
                    const row = Math.floor(index / columns);
                    const col = index % columns;

                    frameObject.crop(x, y, width, height);
                    return compositeImage.composite(frameObject, col * width, row * height);
                }, img));

            return { sheet, json };
        })
        .then(({ sheet, json }) => { // eslint-disable-line arrow-body-style
            const output = {
                cgsPath,
                json,
                image: sheet,
            };

            return outputPath === '.' ?
                output
                :
                mkdirp.mkdirpAsync(outputPath).then(() => output);
        });
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
const readSource = function ({ unitId, frames }, { inputPath }) {
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

const usage =
    `Usage: ffbetool num [-a anim] [-c columns] [-e] [-v] [-j] [-g] [-i inDir] [-o outDir]
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

    if (!id || isNaN(id) || id < 0) {
        console.info(usage);
        return;
    }

    processCggFile(id, options)
        .then((unit) => Promise.all([unit, readSource(unit, options)]))
        .then(([unit, image]) => buildSheet(image, unit, options))
        .then((output) => {
            if (isArray(output)) {
                return output
                    .filter((onefile) => onefile !== null)
                    .map((saveInfo) => saveFile(saveInfo, options));
            }

            return [saveFile(output, options)];
        })
        .then((res) => {
            res.forEach(({ imageSave, jsonSave }) => {
                imageSave
                    .then((message) => console.info(message))
                    .catch((error) => console.error(error));

                if (jsonSave) {
                    jsonSave
                        .then((message) => console.info(message))
                        .catch((error) => console.error(error));
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
