import path from 'path';
import Jimp from 'jimp';
import _fs from 'fs';
import _mkdirp from 'mkdirp';
import { promisifyAll } from 'bluebird';
import { chunk } from 'lodash';

import { createImage, blend, getColorBoundsRect } from './Image';

const fs = promisifyAll(_fs);
const mkdirp = promisifyAll(_mkdirp);

const processArguments = function (...args) {
    let index = 3;
    const { length } = args;
    const output = {};

    while (index < length) {
        switch (args[index]) {
        case '-a':
            output.animName = args[index];
            index += 1;
            break;
        case '-c':
            output.columns = parseInt(args[index], 10);
            index += 1;
            break;
        case '-e':
            output.includeEmpty = true;
            break;
        case '-i':
            output.inputPath = args[index];
            index += 1;
            break;
        case '-o':
            output.outputPath = args[index];
            index += 1;
            break;
        case '-v':
            output.verbose = true;
            break;
        case '-j':
            output.saveJson = true;
            break;
        case '-n':
            output.customFilename = true;
            break;
        default:
        }
    }

    return output;
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

    if (length < 2) {
        return null;
    }

    const [anchor, count] = params;
    return chunk(params, length / count)
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
                anchor,
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
                index,
                flipX: nextType === 1 || nextType === 3,
                flipY: nextType === 2 || nextType === 3,
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
    const { inputPath } = options;

    const { readFileAsync } = fs;
    const cggPath = path.join(inputPath, `unit_cgg_${ unitId }.csv`);

    console.info(`Loading ${ cggPath }...`);

    return readFileAsync(cggPath, 'utf8')
    .then((data) => data.replace('\r').split('\n'))
    .then((data) => data.map(processCggRowData))
    .then((frames) => ({ unitId, frames }));
};

const saveFile = function ({ cgsPath, outputPath, image }) {
    const pathObject = path.parse(cgsPath);
    const { name } = pathObject;
    const [action, uid] = name.split('_cgs_');

    const filename = `unit_${ action }_${ uid }.png`;
    const outputName = path.join(outputPath, filename);

    // if saveJson -> save json to file
    // refer to old file

    return image.write(outputName);
};

const processCgsData = function (rows, sourceImage, options) {
    const { includeEmpty } = options;

    return rows.map((params) => {
        if (params.length < 2) {
            return null;
        }

        const [frameIndex, xPos, yPos/* , delay */] = params;
        // json.delay.push(delay);
        return createImage(2000, 2000)
            .then((blankImage) => frames[frameIndex].reduce((compositeImage, part) => {
                const { imgX, imgY, imgWidth, imgHeight } = part;
                let crop = sourceImage.clone().crop(imgX, imgY, imgWidth, imgHeight);

                const {
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
                    .composite(crop, (2000 / 2) + xPos, (2000 / 2) + yPos);
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
            });
    })   // end lines.map
    .then((frameObjects) => frameObjects.reduce((animObject, frame) => {
        const { frameImages } = animObject;
        const { img = null, rect = null } = frame;
        let { topLeft, bottomRight } = animObject;

        if (!img || !rect) {
            return animObject;
        }

        frameImages.push(img);
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
const makeStrip = function (frames, image, options) {
    const { cgsPath, columns, includeEmpty, outputPath } = options;
    // const { name: animation } = path.parse(cgsPath);
    const json = {};

    // let topLeft = null;
    // let bottomRight = null;
    // let frameImages = [];
    // let frameRect = null;

    return fs.readFileAsync(cgsPath, 'utf8')
        .then((data) => data.replace('\r').split('\n'))
        // .then((data) => Promise.all(data.map(processCgsRowData)))
        .then((lines) => lines.map((line) => line.split(',').slice(0, -1)))
        .then((lines) => processCgsData(lines, image, { includeEmpty }))
        .then((imageObject) => {
            const { frameImages, topLeft, bottomRight } = imageObject;

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
                        const { frame } = frameObject;
                        const { x, y, width, height } = frameRect;
                        frame.crop(x, y, width, height);
                        return compositeImage.composite(frame, index * width, 0);
                    }, img));
            }

            // animation sheet
            return createImage(columns * frameRect.width, rows * frameRect.height)
                .then((img) => frameImages.reduce((compositeImage, frameObject, index) => {
                    const { frame } = frameObject;
                    const { x, y, width, height } = frameRect;
                    const row = index / columns;
                    const col = index % columns;

                    frame.crop(x, y, width, height);
                    return compositeImage.composite(frame, col * width, row * height);
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
    const { inputPath } = options;
    const pngPath = path.join(inputPath, `unit_anime_${ unitId }.png`);
    return Jimp.read(pngPath);
};

const processPng = function (image, options) {
    const { unitId, animName, inputPath } = options;
    if (animName) {
        const cgsPath = path.join(inputPath, `unit_${ animName }_cgs_${ unitId }.csv`);
        return makeStrip(cgsPath, frames, image);
    }

    return fs.readdirAsync(inputPath)
    .then((files) => Promise.all(files.map((file) => {
        const extension = path.extname(file);
        const cgsPath = path.join(inputPath, file);

        if (extension === '.csv' && file.indexOf('_cgs_') >= 0 && file.indexOf(unitId) >= 0) {
            return makeStrip(cgsPath, frames, image);
        }

        throw new Error('Bad file input');
    })));
};

/*
const defaultOptions = {
    id: -1,
    animName: '',
    columns: 0,
    inputPath: '.',
    outputPath: '.',
    includeEmpty: false,
    verbose: false,
    saveJson: false,
    customFilename: false,  // uid_action | default: unit_action_uid,
    ...processArguments(process.argv),
};
*/
const main = (options) => {
    const { id } = options;
    processCggFile(id, options)
        .then(readPng)
        .then(processPng)
        .then(saveFile)
        .catch((error) => {
            console.error(error);
        });
};

export default main;

if (require.main === module) {
    main({ ...defaultOptions, ...processArguments(process.argv) });
}
