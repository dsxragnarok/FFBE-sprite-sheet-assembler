const path = require('path');
const _fs = require('fs'); // eslint-disable-line no-underscore-dangle
const { chunk } = require('lodash');
const { promisifyAll } = require('bluebird');

const { createImage, blend, getColorBoundsRect } = require('./Image');

const fs = promisifyAll(_fs);

const constructFrameFromData = function (data, row) {
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
 * @param {string} [options.cggPath]    The source path to the cgg file,
 * if not given then the filePath will be constructed using unitId and inputPath
 * @return {Promise} The Promise resolving to an object containing unitId and
 *                   the animation frames' data
 */
const readCggFile = async function (unitId, {
    inputPath,
    cggPath,
}) {
    console.info(' --- Reading Cgg File');
    const { readFileAsync } = fs;
    const filePath = cggPath || path.join(inputPath, `unit_cgg_${ unitId }.csv`);

    console.info(`\tLoading [${ filePath }]`);

    const data = await readFileAsync(filePath, 'utf8');
    const frames = data.replace('\r').split('\n').map(constructFrameFromData);

    return { unitId, frames };
};

const compositeImageFrame = function (frameMetadata, x, y, sourceImage, targetImage) {
    return frameMetadata.reduce((construct, part) => {
        const {
            imgX,
            imgY,
            imgWidth,
            imgHeight,
        } = part;
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
            console.log(`--% Rotate [${ rotate }] %--`);
            crop.rotate(rotate, true);
        }

        if (opacity < 100) {
            crop.opacity(opacity / 100);
        }

        return construct.composite(crop,
            (2000 / 2) + parseInt(x, 10) + xPos,
            (2000 / 2) + parseInt(y, 10) + yPos);
    }, targetImage);
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
const constructAnimationFrames = async function (rows, frames, sourceImage, { includeEmpty }) {
    console.info(' --- Construct Animation Frames');
    const data = rows.map(async (params) => {
        if (params.length < 2) {
            return null;
        }

        const [frameIndex, x, y, delay] = params;

        try {
            const blankImage = await createImage(2000, 2000);
            const compositeImage = compositeImageFrame(frames[frameIndex],
                x, y, sourceImage, blankImage);

            const rect = getColorBoundsRect(compositeImage, 0xFF000000, 0, false);
            if ((rect.width > 0 && rect.height > 0) || includeEmpty) {
                return {
                    rect,
                    compositeImage,
                    delay,
                };
            }
        } catch (error) {
            console.error(error);
            return null;
        }

        return null;
    });

    const framesData = await Promise.all(data);
    return framesData.reduce((animObject, frame) => {
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
            const {
                x,
                y,
                width,
                height,
            } = rect;
            topLeft = { x, y };
            bottomRight = { x: x + width, y: y + height };
        } else if (rect) {
            const {
                x,
                y,
                width,
                height,
            } = rect;
            topLeft = {
                x: Math.min(x, topLeft.x),
                y: Math.min(y, topLeft.y),
            };
            bottomRight = {
                x: Math.max(x + width, bottomRight.x),
                y: Math.max(y + height, bottomRight.y),
            };
        }

        return {
            frameImages,
            frameDelays,
            topLeft,
            bottomRight,
        };
    }, {
        frameImages: [],
        frameDelays: [],
        topLeft: null,
        bottomRight: null,
    });
};

module.exports = {
    readCggFile,
    constructAnimationFrames,
};
