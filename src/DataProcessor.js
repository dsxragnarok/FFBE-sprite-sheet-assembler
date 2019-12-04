const path = require('path');
const _fs = require('fs'); // eslint-disable-line no-underscore-dangle
const { chunk } = require('lodash');
const { promisifyAll } = require('bluebird');

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

module.exports = {
    readCggFile,
};
