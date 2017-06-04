import Jimp, { intToRGBA, rgbaToInt } from 'jimp';
import { range } from 'lodash';

/**
 * Creates a Promise wrapper around Jimp's constructor.
 *
 * @param {number} width - The image width in pixels
 * @param {number} height - The image height in pixels
 * @return {Promise} - Promise resolving to a Jimp object
 */
export const createImage = function (width, height) {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line no-new
        new Jimp(width, height, (err, image) => {
            if (err) {
                return reject(err);
            }

            return resolve(image);
        });
    });
};

/**
 * Converts color range of form 0.0-1.0 to 0-255
 *
 * @param {Object} pixel    Object describing the pixel colors in range 0-1
 * @param {number} pixel.r  The red channel
 * @param {number} pixel.g  The green channel
 * @param {number} pixel.b  The blue channel
 * @param {number} pixel.a  The alpha channel
 * @return {Object} The object describing the pixel colors in range 0-255
 */
const convertColorToDecimalRange = function ({ r, g, b, a }) {
    return {
        r: r / 255,
        g: g / 255,
        b: b / 255,
        a: a / 255,
    };
};

/**
 * Converts color range of form 0-255 to 0.0-1.0
 *
 * @param {Object} pixel    Object describing the pixel colors in range 0-255
 * @param {number} pixel.r  The red channel
 * @param {number} pixel.g  The green channel
 * @param {number} pixel.b  The blue channel
 * @param {number} pixel.a  The alpha channel
 * @return {Object} The object describing the pixel colors in range 0-1
 */
const convertColorTo255Range = function ({ r, g, b, a }) {
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255),
        a: Math.round(a * 255),
    };
};

/**
 * Applies a blending of color channels
 *
 * @param {Jimp}    The Jimp image object to apply blending
 * @return {Jimp}   The transformed Jimp image object
 */
export const blend = function (image) {
    // const { bitmap, getPixelColor, setPixelColor } = image;
    const { width, height } = image.bitmap;

    range(width).forEach((col) => {
        range(height).forEach((row) => {
            const { a, r, g, b } =
                convertColorToDecimalRange(intToRGBA(image.getPixelColor(col, row)));

            if (a !== 0) {
                const pixel = convertColorTo255Range({
                    r: r * a,
                    g: g * a,
                    b: b * a,
                    a: (r + g + b) / 3,
                });

                image.setPixelColor(rgbaToInt(pixel.r, pixel.g, pixel.b, pixel.a), col, row);
            }
        });
    });

    return image;
};

// mask : hex
// color : hex
// findColor : boolean

// attempt to implement haxe's
// function getColorBoundsRect( mask : UInt, color : UInt, ?findColor : Bool ) : Rectangle
/*
   Determines a rectangular region that either fully encloses all pixels of a specified color
   within the bitmap image (if the findColor parameter is set to true) or fully encloses all pixels
   that do not include the specified color (if the findColor parameter is set to false).

   For example, if you have a source image and you want to determine the rectangle of the image
   that contains a nonzero alpha channel, pass {mask: 0xFF000000, color: 0x00000000} as parameters.
   If the findColor parameter is set to true, the entire image is searched for the bounds of pixels
   for which (value & mask) == color (where value is the color value of the pixel). If the
   findColor parameter is set to false, the entire image is searched for the bounds of pixels for
   which (value & mask) != color (where value is the color value of the pixel). To determine white
   space around an image, pass {mask: 0xFFFFFFFF, color: 0xFFFFFFFF} to find the bounds of nonwhite
   pixels.
*/
export const getColorBoundsRect = function (image, mask, color, findColor) {
    // findColor : value & mask === color
    // !findColor : value & mask !== color
    const { width, height } = image.bitmap;

    const extremities = range(height).reduce((acc, row) =>
        range(width).reduce((obj, col) => {
            const pixelColor = image.getPixelColor(col, row);

            // eslint-disable-next-line no-bitwise
            if ((findColor && (pixelColor & mask === color)) || (pixelColor & mask !== color)) {
                const { minx, miny, maxx, maxy } = obj;
                return {
                    minx: col < minx ? col : minx,
                    miny: row < miny ? row : miny,
                    maxx: col > maxx ? col : maxx,
                    maxy: row > maxy ? row : maxy,
                };
            }
            return obj;
        }, acc)
    , { minx: width, maxx: 0, miny: height, maxy: 0 });

    const { minx: x, miny: y, maxx, maxy } = extremities;

    return {
        x,
        y,
        width: Math.max(0, (maxx - x) + 1),
        height: Math.max(0, (maxy - y) + 1),
    };
};

export default {
    createImage,
    blend,
    getColorBoundsRect,
};
