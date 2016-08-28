var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var mkdirp = Promise.promisifyAll(require('mkdirp'));
var path = require('path');
var _ = require('underscore');
var Jimp = require('jimp');

var usage = 'Usage: main num [-a anim] [-c columns] [-e] [-i inDir] [-o outDir]';

var ffbeTool = function () {
   this.id = -1;
   this.animName = '';
   this.columns = 0;
   this.inputPath = '.';
   this.outputPath = '.';
   this.includeEmpty = false;

   this.cggPath = null;
   this.pngPath = null;

   this.frames = [];
};

// mask : hex
// color : hex
// findColor : boolean

// attempt to implement haxe's
// function getColorBoundsRect( mask : UInt, color : UInt, ?findColor : Bool ) : Rectangle
/*
   Determines a rectangular region that either fully encloses all pixels of a specified color within the bitmap image (if the findColor parameter is set to true) or fully encloses all pixels that do not include the specified color (if the findColor parameter is set to false).

   For example, if you have a source image and you want to determine the rectangle of the image that contains a nonzero alpha channel, pass {mask: 0xFF000000, color: 0x00000000} as parameters. If the findColor parameter is set to true, the entire image is searched for the bounds of pixels for which (value & mask) == color (where value is the color value of the pixel). If the findColor parameter is set to false, the entire image is searched for the bounds of pixels for which (value & mask) != color (where value is the color value of the pixel). To determine white space around an image, pass {mask: 0xFFFFFFFF, color: 0xFFFFFFFF} to find the bounds of nonwhite pixels.
*/
var getColorBoundsRect = function (image, mask, color, findColor) {
   //findColor : value & mask === color
   //!findColor : value & mask !== color

   var width = image.bitmap.width;
   var height = image.bitmap.height;

   var minx = image.bitmap.width;
   var maxx = 0;
   var miny = image.bitmap.height;
   var maxy = 0;

   _.each(_.range(height), function (y) {
      _.each(_.range(width), function (x) {
         var value = image.getPixelColor(x, y);

         if (findColor) {
            if (value & mask === color) {
               if (x < minx) {
                  minx = x;
               }
               if (x > maxx) {
                  maxx = x;
               }
               if (y < miny) {
                  miny = y;
               }
               if (y > maxy) {
                  maxy = y;
               }
            }
         } else {
            if (value & mask !== color) {
               if (x < minx) {
                  minx = x;
               }
               if (x > maxx) {
                  maxx = x;
               }
               if (y < miny) {
                  miny = y;
               }
               if (y > maxy) {
                  maxy = y;
               }
            }
         }
      }); // end each y
   }); // end each x

   return {
      x: minx,
      y: miny,
      width: Math.max(0, maxx - minx + 1),
      height: Math.max(0, maxy - miny + 1)
   };
};

// Promise wrap Jimp constructor
var createImage = function (width, height) {
   return new Promise(function (resolve, reject) {
      new Jimp(width, height, function (err, image) {
         if (err) {
            return reject(err);
         }

         return resolve(image);
      });
   });
};

var blend = function (image) {
   _.each(_.range(image.bitmap.width), function (x) {
      _.each(_.range(image.bitmap.height), function (y) {
         var pixel = convertColorRange01(Jimp.intToRGBA(image.getPixelColor(x, y)));

         if (pixel.a !== 0) {
            pixel.r = pixel.r * pixel.a;
            pixel.g = pixel.g * pixel.a;
            pixel.b = pixel.b * pixel.a;
            pixel.a = (pixel.r + pixel.g + pixel.b) / 3;

            pixel = convertColorRange255(pixel);
            image.setPixelColor(Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, pixel.a), x, y);
         }
      }); // end y
   }); // end x

   return image;
};

var convertColorRange01 = function (r, g, b, a) {
   var color = {};
   if (typeof r === 'object') {
      color = r;
   } else {
      color.r = r;
      color.g = g;
      color.b = b;
      color.a = a;
   }

   return {
      r: color.r / 255,
      g: color.g / 255,
      b: color.b / 255,
      a: color.a / 255
   };
};

var convertColorRange255 = function (r, g, b, a) {
   var color = {};
   if (typeof r === 'object') {
      color = r;
   } else {
      color.r = r;
      color.g = g;
      color.b = b;
      color.a = a;
   }

   return {
      r: Math.round(color.r * 255),
      g: Math.round(color.g * 255),
      b: Math.round(color.b * 255),
      a: Math.round(color.a * 255)
   };
};

ffbeTool.prototype = {
   processCommandArgs: function (argv) {
      var i = 3, len = argv.length;

      while (i < len) {
         switch(argv[i]) {
            case '-a':
               this.animName = argv[++i];
               break;
            case '-c':
               this.columns = parseInt(argv[++i]);
               break;
            case '-e':
               this.includeEmpty = true;
               break;
            case '-i':
               this.inputPath = argv[++i];
               break;
            case '-o':
               this.outputPath = argv[++i];
               break;
         }
         i += 1;
      }
   },

   readCggAsync: function (unitID) {
      this.cggPath = path.join(this.inputPath, 'unit_cgg_' + unitID + '.csv');

      console.info('Loading ' + this.cggPath + '...');

      return fs.readFileAsync(this.cggPath, 'utf8')
         .then(function (data) {
            var datasplit = data.replace('\r').split('\n');

            var processDataLine = function (line, index) {
               return new Promise(function (resolve, reject) {
                  var params = line.split(',');
                  params.splice(params.length - 1, 1);

                  var anchor = 0,
                     count = 0,
                     parts = [],
                     part = null,
                     i = 0;

                  if (params.length >= 2) {
                     anchor = parseInt(params[0]);
                     count = parseInt(params[1]);
                     parts = [], i = 2;

                     _.each(_.range(count), function (partInd) {
                        part = {};

                        part.xPos = parseInt(params[i++]);
                        part.yPos = parseInt(params[i++]);
                        part.nextType = parseInt(params[i++]);
                        part.flipX = false;
                        part.flipY = false;

                        switch (part.nextType) {
                           case 0:
                              break;
                           case 1:
                              part.flipX = true;
                              break;
                           case 2:
                              part.flipY = true;
                              break;
                           case 3:
                              part.flipX = true;
                              part.flipY = true;
                              break;
                           default:
                              console.log("Invalid next type!");
                              return reject("Invalid next type!");
                        } // end switch

                        part.blendMode = parseInt(params[i++]);
                        part.opacity = parseInt(params[i++]);
                        part.rotate = parseInt(params[i++]);
                        part.imgX = parseInt(params[i++]);
                        part.imgY = parseInt(params[i++]);
                        part.imgWidth = parseInt(params[i++]);
                        part.imgHeight = parseInt(params[i++]);
                        part.pageID = parseInt(params[i++]);

                        part.lineIndex = index;
                        part.line = line;
                        part.index = partInd;

                        parts.push(part);
                     }); // end inner _.each

                     return resolve(parts.reverse());
                  } else {
                     console.log('line ' + index + ' : params.length was less than 2');
                     return resolve(null);
                  }
               }); // end Promise
            }; // end processDataLine

            var processing = datasplit.map(processDataLine);
            var results = Promise.all(processing);

            return results.then(function (frames) {
               return {
                  unitID: unitID,
                  frames: frames
               };
            });
         }); // end readFileAsync
   },

   readPngAsync: function (data) {
      var frames = data.frames;
      var unitID = data.unitID;

      var inputPath = this.inputPath;

      var pngPath = path.join(this.inputPath, 'unit_anime_' + unitID + '.png');
      var png = Jimp.read(pngPath);
      var cgsPath;

      if (this.animName) {
         cgsPath = path.join(inputPath, 'unit_' + this.animName + '_cgs_' + unitID + '.csv');
         return png.then(_.bind(function (image) {
            this.makeStrip(cgsPath, frames, image);
         }, this));
      } else {
         console.log(' * No animName *');
         return png.then(_.bind(function (image) {
            fs.readdirAsync(this.inputPath).map(_.bind(function (file) {

               var extension = path.extname(file);
               cgsPath = path.join(this.inputPath, file);

               if (extension === '.csv' && file.indexOf('_cgs_') >= 0 &&
                  file.indexOf(unitID) >= 0) {

                  console.log(' -- ' + file + ' is target cgs');
                  this.makeStrip(cgsPath, frames, image);
               }
            }, this)).catch(function (err) {
               console.log(err.stack);
            });
         }, this));
      }
   },

   /**
     * Cuts the sprites from the source image using information from a cgs and * cgg data and turns them into a strip
     * @param cgsPath - string
     * @param frames - array[array[CggPart]]
     * @param img - JIMP image?
     */
   makeStrip: function (cgsPath, frames, img) {
      console.log('Loading ' + cgsPath);

      var columns = this.columns;
      var outputPath = this.outputPath;
      var includeEmpty = this.includeEmpty;

      var ffbeScope = this;

      return fs.readFileAsync(cgsPath, 'utf8')
         .then(function (data) {
            var topLeft = null;
            var bottomRight = null;
            var frameImages = [];
            var frameRect = null;

            var datasplit = data.replace('\r').split('\n');

            var processDataLine = function (line, index) {
               return new Promise(function (resolve, reject) {
                  var params = line.split(',');
                  params.splice(params.length-1, 1);

                  var frameIndex, xPos, yPos, delay, frameImage;

                  if (params.length < 2) {
                     console.log('params.length was less than 2');

                     // resolving this as null, otherwise the entire
                     // Promise is rejected
                     return resolve(null);
                  }

                  frameIndex = parseInt(params[0]);
                  xPos = parseInt(params[1]);
                  yPos = parseInt(params[2]);
                  delay = parseInt(params[3]);

                  createImage(2000, 2000).then(function (image) {
                     _.each(frames[frameIndex], function (part, idx) {
                        var crop;
                        var clone = img.clone(); // NOTE: crop is destructive, so we must reclone
                        crop = clone.crop(part.imgX, part.imgY, part.imgWidth, part.imgHeight);

                        if (part.blendMode === 1) {
                           console.log(' -- blending part -- ' );
                           crop = blend(crop);
                        }

                        if (part.flipX || part.flipY) {
                           console.log(' -- flipping horizontal: ' + part.flipX + ', vertical: ' + part.flipY);
                           crop.flip(part.flipX, part.flipY);
                        }

                        if (part.rotate !== 0) {
                           console.log(' -- rotating part: ' + part.rotate);
                           // NOTE: Jimp rotates clockwise whereas the cgg setting for
                           // rotation is given in terms of counter-clockwise rotation
                           // So multiply by -1 to reverse it.
                           crop.rotate(-1 * part.rotate, true);
                        }

                        if (part.opacity < 100) {
                           console.log(' -- reducing opacity: ' + part.opacity);
                           crop.opacity(part.opacity / 100);
                        }

                        console.log(' -- writing part ' + idx + ' of Frame ' + frameIndex + ' from line ' + index);
                        image.composite(crop, 2000/2 + part.xPos + xPos, 2000/2 + part.yPos + yPos);
                     }); // end part.each

                     var rect = getColorBoundsRect(image, 0xFF000000, 0, false);
                     var frameObject = {
                        image: image,
                        rect: rect
                     };

                     if (rect.width > 0 && rect.height > 0) {
                        frameImages.push(frameObject);

                        if (topLeft === null) {
                           topLeft = {x: rect.x, y: rect.y};
                           bottomRight = {
                              x: rect.x + rect.width,
                              y: rect.y + rect.height
                           };
                        } else {
                           topLeft.x = Math.min(rect.x, topLeft.x);
                           topLeft.y = Math.min(rect.y, topLeft.y);
                           bottomRight.x = Math.max(rect.x + rect.width, bottomRight.x);
                           bottomRight.y = Math.max(rect.y + rect.height, bottomRight.y);
                        }

                        console.log('Frame ' + frameImages.length + ' done');
                     } else if (includeEmpty) {
                        frameImages.push(frameObject);
                     } // end if rect.width > 0 and rect.height > 0


                     resolve(image);
                  }); // end createImage.then
               }); // end Promise
            }; // end processDataLine

            var processing = datasplit.map(processDataLine)
            var results = Promise.all(processing);

            return results.then(function (image) {
               console.log('--- Making strip ---');

               frameRect = {
                  x: topLeft.x - 5,
                  y: topLeft.y - 5,
                  width: bottomRight.x - topLeft.x + 10,
                  height: bottomRight.y - topLeft.y + 10
               };

               var animImage = null;
               var tmpColumns = columns;
               var rows = Math.ceil(frameImages.length / columns);

               if (columns === 0 || columns >= frameImages.length) {
                  columns = frameImages.length;
                  createImage(frameImages.length * frameRect.width, frameRect.height)
                     .then(function (image) {
                        _.each(_.range(frameImages.length), function (index) {
                           var frameObject = frameImages[index];
                           var frame = frameObject.image;
                           var rect = frameObject.rect;
                           frame.crop(frameRect.x, frameRect.y, frameRect.width, frameRect.height);

                           console.log('compositing frame ' + (index + 1) + ' to strip');

                           image.composite(frame, index * frameRect.width, 0);
                        }); // end each frame

                        return image;
                     }) // end createImage.then
                     .then(function (image) {
                        if (outputPath !== '.') {
                           return mkdirp.mkdirpAsync(outputPath).then(function (directory) {
                              return Promise.resolve({
                                 outputPath: outputPath,
                                 cgsPath: cgsPath,
                                 image: image
                              });
                           });
                        } else {
                           return Promise.resolve({
                              outputPath: outputPath,
                              cgsPath: cgsPath,
                              image: image
                           });
                        }
                     })
                     .then(ffbeScope.saveFile);
               } else {
                  createImage(columns * frameRect.width, rows * frameRect.height)
                     .then(function (image) {
                        _.each(_.range(rows), function (row) {
                           _.each(_.range(columns), function (col) {
                              var index = (row * columns) + col;
                              var frameObject = frameImages[index];

                              var frame, rect;

                              if (frameObject) {
                                 frame = frameObject.image;
                                 rect = frameObject.rect;

                                 frame.crop(frameRect.x, frameRect.y, frameRect.width, frameRect.height);

                                 console.log('compositing frame ' + (index + 1) + ' to sheet');
                                 image.composite(frame, col * frameRect.width, row * frameRect.height);
                              }
                           }); // end each col
                        }); // end each row

                        return image;
                     }) // end createImage.then
                     .then(function (image) {
                        if (outputPath !== '.') {
                           return mkdirp.mkdirpAsync(outputPath).then(function (directory) {
                              return Promise.resolve({
                                 outputPath: outputPath,
                                 cgsPath: cgsPath,
                                 image: image
                              });
                           });
                        } else {
                           return Promise.resolve({
                              outputPath: outputPath,
                              cgsPath: cgsPath,
                              image: image
                           });
                        }
                     })
                     .then(ffbeScope.saveFile);
               } // end if-else
            }); // end results.then

         }); // end readFileAsync
   }, // end makeStrip

   saveFile: function (saveObject) {
      var pathObject = path.parse(saveObject.cgsPath);
      var bits = pathObject.name.split('_cgs_');
      var action = bits[0].substring('unit_'.length);
      var uid = bits[1];

      var filename = uid + '_' + action + '.png';
      var outputName = path.join(saveObject.outputPath, filename);

      console.log('saving sprite strip : ' + outputName);
      saveObject.image.write(outputName);
   }
};

var main = function (argv) {
   var ffbe = new ffbeTool();

   if (argv.length < 3) {
      console.info(usage);
      return;
   }

   ffbe.id = parseInt(argv[2]);
   if (isNaN(ffbe.id)) {
      console.info(ffbe.usage);
      return;
   }

   ffbe.processCommandArgs(process.argv);

   ffbe.readCggAsync(ffbe.id)
      .then(_.bind(ffbe.readPngAsync, ffbe))
      .catch(function (err) {
         console.error(err);
      });
};

main(process.argv);
