var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var _ = require('underscore');
var Jimp = require('jimp');

var usage = 'Usage: main num [-a anim] [-c columns] [-d divider thickness] [-e] [-i inDir] [-o outDir]';

var ffbeTool = function () {
   this.id = -1;
   this.animName = '';
   this.columns = 0;
   this.dividerSize = 0;
   this.includeEmpty = false;
   this.inputPath = '.';
   this.outputPath = '.';

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
            case '-d':
               this.dividerSize = parseInt(argv[++i]);
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
      this.cggPath = this.inputPath + '/' + 'unit_cgg_' + unitID + '.csv';

      console.info('Loading ' + this.cggPath + '...');
      
      var ffbeScope = this;
      var returnObject = {
         unitID: unitID
      };

      return fs.readFileAsync(this.cggPath, 'utf8')
         .then(function (data) {
            var frames = [];
            var datasplit = data.split('\r\n');
            _.each(datasplit, function (line, index) {
               var params = line.split(',');
               params.splice(params.length - 1, 1);
               //console.log('line: ' + index + ' param.length = ' + params.length);
               //console.log(params);
               var anchor = 0, 
                  count = 0, 
                  parts = [], 
                  part = null, 
                  i = 0;

               if (params.length >= 2) {
                  anchor = parseInt(params[0]);
                  count = parseInt(params[1]);
                  parts = [], i = 2;

                  //console.log('count: ' + count + ' | ' + (params.length-2)/count);

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
                           process.exit(1);
                           return;  // we probably want to exit application...
                        } // end switch
                     part.blendMode = parseInt(params[i++]);
                     part.opacity = parseInt(params[i++]);
                     part.rotate = parseInt(params[i++]);
                     part.imgX = parseInt(params[i++]);
                     part.imgY = parseInt(params[i++]);
                     part.imgWidth = parseInt(params[i++]);
                     part.imgHeight = parseInt(params[i++]);
                     part.pageID = parseInt(params[i++]);

                     //console.log(part);

                     parts.push(part);
                  }); // end inner _.each
                  parts.reverse();
                  frames.push(parts);
               } else {
                  console.log('params.length was less than 2');
               }

            }); // end outer _.each

            returnObject.frames = frames;

            return returnObject;
         }); // end readFileAsync
   },

   readPngAsync: function (data) {
      var frames = data.frames;
      var unitID = data.unitID;

      // TODO: fix this hardcoded this.animName
      this.animName = 'idle';

      var pngPath = this.inputPath + '/unit_anime_' + unitID + '.png';
      var cgsPath = this.inputPath + '/unit_' + this.animName + '_cgs_' + unitID + '.csv';

      Jimp.read(pngPath).then(_.bind(function (image) {
         this.makeStrip(cgsPath, frames, image);
      }, this)).catch(function (err) {
         console.error(err.stack);
      });

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
      var dividerSize = this.dividerSize;
      var outputPath = this.outputPath;

      fs.readFileAsync(cgsPath, 'utf8')
         .then(function (data) {
            var topLeft = null;
            var bottomRight = null;
            var frameImages = [];
            var frameRect = null;

            var clone = img.clone();

            var datasplit = data.split('\r\n');

            // NOTE: find iterates and runs the code for each element in the
            // array until it reaches a condition that returns which breaks
            // out of the loop
            _.find(datasplit, function (line, index) {
               var params = line.split(',');
               params.splice(params.length-1, 1);

               var frameIndex, xPos, yPos, delay, frameImage;

               if (params.length < 2) {
                  console.log('params.length was less than 2');
                  return true;
               }

               frameIndex = parseInt(params[0]);
               xPos = parseInt(params[1]);
               yPos = parseInt(params[2]);
               delay = parseInt(params[3]);

               new Jimp(2000, 2000, function (err, image) {
                  _.each(frames[frameIndex], function (part, idx) {
                     var crop;
                     var fname = 'outs/crop-' + index + '-' + frameIndex + '-' + idx + '.png';
                     clone = img.clone(); // NOTE: crop is destructive, so we must reclone

                     crop = clone.crop(part.imgX, part.imgY, part.imgWidth, part.imgHeight);

                     // TODO: manipulate the image
                     // blend(), rotate(), flipx, flipy, colorTransform

                     console.log(' -- writing part ' + index + ' ' + frameIndex + ' - ' + idx);
                     
                     image.composite(crop, 2000/2 + part.xPos + xPos, 2000/2 + part.yPos + yPos);
                  }); // end part.each

                  var rect = getColorBoundsRect(image, 0xFF000000, 0, false);
                  var frameObject = {};
                  if (rect.width > 0 && rect.height > 0) {
                     frameObject = {
                        image: image.crop(rect.x, rect.y, rect.width, rect.height),
                        rect: rect
                     };
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
                  }
               }); // end of new Jimp
            }); // end line.each

            // NOTE: possible issue with nature of asynchronicity
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
               new Jimp(
                  frameImages.length * (frameRect.width + dividerSize) - dividerSize,
                  frameRect.height,
                  function (err, image) {
                     if (err) {
                        console.log('new jimp error', err);
                     }

                     _.each(_.range(frameImages.length), function (index) {
                        var frameObject = frameImages[index];
                        var frame = frameObject.image;
                        var rect = frameObject.rect;
                        
                        console.log('compositing frame ' + index + ' to strip');

                        image.composite(frame, index * (frameRect.width + dividerSize), 0);
                     }); // end each frame

                     if (dividerSize > 0) {
                        // addDividers(image, frameRect, 0);
                     }

                     if (outputPath !== '.') {
                        fs.mkdirAsync(outputPath).then(function (directory) {
                           var filename = cgsPath.replace(/^.*[\\\/]/, '').slice(0, -4);
                           var bits = filename.split('_');

                           var outputName = outputPath + '/' + bits[1] + '_' + bits[3] + '.png';

                           console.log('saving image strip : ' + outputName);
                           image.write(outputName);
                        });
                     }

                  }); // end new Jimp
            } else {
               new Jimp(
                  (columns * frameRect.width) + ((columns - 1) * dividerSize),
                  (rows * frameRect.height) + ((rows - 1) * dividerSize),
                  function (err, image) {
                     _.each(_.range(rows), function (row) {
                        _.each(_.range(columns), function (col) {
                           var index = (row * columns) + col;
                           var frameObject = frameImages[index];
                           var frame = frameObject.image;
                           var rect = frameObject.rect;

                           console.log('compositing frame ' + index + ' to strip');
                           image.composite(frame, 
                                          col * (frameRect.width + dividerSize),
                                          row * (frameRect.height + dividerSize));
                        }); // end each col
                     }); // end each row

                     if (dividerSize > 0) {
                        // addDividers(image, frameRect, rows);
                     }

                     if (outputPath !== '.') {
                        fs.mkdirAsync(outputPath).then(function (directory) {
                           var filename = cgsPath.replace(/^.*[\\\/]/, '').slice(0, -4);
                           var bits = filename.split('_');

                           var outputName = outputPath + '/' + bits[1] + '_' + bits[3] + '.png';

                           console.log('saving sprite sheet : ' + outputName);
                           image.write(outputName);
                        });
                     }

                  }); // end new Jimp
            } // end if-else
         }); // end readFileAsync
   } // end makeStrip
};

var main = function (argv) {
   var ffbe = new ffbeTool();

   if (argv.length < 3) {
      console.log(usage);
      return;
   }

   ffbe.id = parseInt(argv[2]);
   if (isNaN(ffbe.id)) {
      console.info(ffbe.usage);
      return;
   }

   ffbe.processCommandArgs(process.argv);

   ffbe.readCggAsync(ffbe.id)
      .then(_.bind(ffbe.readPngAsync, ffbe));
};

main(process.argv);