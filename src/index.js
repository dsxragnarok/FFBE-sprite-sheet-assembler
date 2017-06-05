import path from 'path';
import Jimp from 'jimp';
import _fs from 'fs';
import _mkdirp from 'mkdirp';
import { promisifyAll } from 'bluebird';
import { chunk, isArray } from 'lodash';

import { createImage, blend, getColorBoundsRect } from './Image';

const fs = promisifyAll(_fs);
const mkdirp = promisifyAll(_mkdirp);

const processArguments = function (...args) {
    return args.reduce((options, arg, index) => {
        switch (arg) {
        case '-a':
            return { ...options, animName: args[index + 1] };
        case '-c':
            return { ...options, columns: parseInt(args[index + 1], 10) };
        case '-e':
            return { ...options, includeEmpty: true };
        case '-i':
            return { ...options, inputPath: args[index + 1] };
        case '-o':
            return { ...options, outputPath: args[index + 1] };
        case '-v':
            return { ...options, verbose: true };
        case '-j':
            return { ...options, saveJson: true };
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
    customFilename: false,  // {boolean} false: `unit_${action}_${uid}` | true: `${uid}_${action}`,
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

    console.info(' --- Processing Cgg Row --- ', row);
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
const processCggFile = function (unitId, options) {
    console.info('--- Processing Cgg File ---');
    const { inputPath } = options;

    const { readFileAsync } = fs;
    const cggPath = path.join(inputPath, `unit_cgg_${ unitId }.csv`);

    console.info(`Loading ${ cggPath }`);

    return readFileAsync(cggPath, 'utf8')
        .then((data) => data.replace('\r').split('\n'))
        .then((data) => data.map(processCggRowData))
        .then((frames) => ({ unitId, frames }));
};

const saveFile = function ({ cgsPath, outputPath, image }) {
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `${ action }_${ uid }.png`;
    const outputName = path.join(outputPath, filename);

    // if saveJson -> save json to file
    // refer to old file

    console.info(' * Saving ', outputName);
    return image.write(outputName);
};

const processCgsData = function (rows, frames, sourceImage, options) {
    console.info(' --- Process Cgs Data --- ');
    const { includeEmpty } = options;

    return Promise.all(rows.map((params) => {
        if (params.length < 2) {
            return null;
        }

        const [frameIndex, x, y/* , delay */] = params;
        // json.delay.push(delay);
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
        console.info(' -- reducing to animObject -- ');
        if (!frame) {
            return animObject;
        }

        const { frameImages } = animObject;
        const { compositeImage = null, rect = null } = frame;
        let { topLeft, bottomRight } = animObject;

        if (!compositeImage || !rect) {
            return animObject;
        }

        frameImages.push(compositeImage);
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

        return { frameImages, topLeft, bottomRight };
    }, { frameImages: [], topLeft: null, bottomRight: null }));
};

/**
 * @todo finish implementation
 */
const makeStrip = function (cgsPath, frames, image, options) {
    console.info(' --- Making Animation Strip --- ');
    const { columns, outputPath } = options;

    console.info(`\tcgsPath [${ cgsPath }]`);
    // const { name: animation } = path.parse(cgsPath);
    const json = {};

    return fs.readFileAsync(cgsPath, 'utf8')
        .then((data) => data.replace('\r').split('\n'))
        // .then((data) => Promise.all(data.map(processCgsRowData)))
        .then((lines) => lines.map((line) => line.split(',').slice(0, -1)))
        .then((lines) => processCgsData(lines, frames, image, options))
        .then((imageObject) => {
            console.info(' * * DONE processing Cgs Data * * ');
            const { frameImages, topLeft, bottomRight } = imageObject;
            console.info(topLeft, bottomRight);

            const frameRect = {
                x: topLeft.x - 5,
                y: topLeft.y - 5,
                width: (bottomRight.x - topLeft.x) + 10,
                height: (bottomRight.y - topLeft.y) + 10,
            };

            json.frameDimensions = frameRect;

            const rows = Math.ceil(frameImages.length / columns);

            if (columns === 0 || columns >= frameImages.length) {
                // animation strip
                return createImage(frameImages.length * frameRect.width, frameRect.height)
                    .then((img) => frameImages.reduce((compositeImage, frameObject, index) => {
                        const { x, y, width, height } = frameRect;
                        frameObject.crop(x, y, width, height);
                        return compositeImage.composite(frameObject, index * width, 0);
                    }, img));
            }

            // animation sheet
            return createImage(columns * frameRect.width, rows * frameRect.height)
                .then((img) => frameImages.reduce((compositeImage, frameObject, index) => {
                    const { x, y, width, height } = frameRect;
                    const row = Math.floor(index / columns);
                    const col = index % columns;

                    frameObject.crop(x, y, width, height);
                    return compositeImage.composite(frameObject, col * width, row * height);
                }, img));
        })
        .then((spritesheet) => { // eslint-disable-line arrow-body-style
            const output = {
                outputPath,
                cgsPath,
                json,
                image: spritesheet,
            };

            return outputPath === '.' ?
                output
                :
                mkdirp.mkdirpAsync(outputPath).then(() => output);
        });
};

/**
 * Reads the source png and creates an image strip for a single animation or all animations
 *
 * @param {Object} unit - An object describing a single character unit
 * @param {string} unit.unitId - The unit's id
 * @param {array} unit.frames - The unit's animation frames
 * @param {Object} options - The command options
 * @param {string} options.animName - The name of animation to process,
 *                                    if not given will process all animations
 * @param {string} options.inputPath - The file input path
 * @return {Promise} - The Promise resolving to the Jimp image of the sprite sheet
 */
const readPng = function ({ unitId, frames }, options) {
    console.info(' --- Read Png ---');

    const { inputPath } = options;
    const pngPath = path.join(inputPath, `unit_anime_${ unitId }.png`);

    console.info(`\tpngPath: [${ pngPath }]`);

    return Jimp.read(pngPath);
};

const processPng = function (image, { unitId, frames }, options) {
    console.info(' --- Processing Png --- ');
    const { animName, inputPath } = options;

    if (animName) {
        console.error(' --- animation name --- ');
        const cgsPath = path.join(inputPath, `unit_${ animName }_cgs_${ unitId }.csv`);
        return makeStrip(cgsPath, frames, image, options);
    }

    return fs.readdirAsync(inputPath)
    .then((files) => Promise.all(files.map((file) => {
        if (file.search(/^(unit_).+_cgs_\d+(\.csv)$/) > -1 && file.indexOf(unitId) > -1) {
            const cgsPath = path.join(inputPath, file);
            console.info(`\t * Make strip from ${ cgsPath }`);
            return makeStrip(cgsPath, frames, image, options);
        }

        return null;
    })));
};

const usage = 'Usage: main num [-a anim] [-c columns] [-e] [-v] [-j] [-i inDir] [-o outDir]';

const main = (options) => {
    const { id } = options;

    if (!id || isNaN(id) || id < 0) {
        console.info(usage);
        return;
    }

    processCggFile(id, options)
        .then((unit) => readPng(unit, options).then((image) => processPng(image, unit, options)))
        .then((output) => {
            if (isArray(output)) {
                return output
                    .filter((onefile) => onefile !== null)
                    .map((saveInfo) => saveFile(saveInfo));
            }

            return saveFile(output);
        })
        .catch((error) => {
            console.error(error);
        });
};

export default main;

if (require.main === module) {
    main({
        ...defaultOptions,
        ...processArguments(...process.argv),
        id: parseInt(process.argv[2], 10),
    });
}
