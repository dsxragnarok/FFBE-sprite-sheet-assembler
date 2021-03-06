## [0.3.0]

### New Features

* Added the [-g] option to output an animated gif

## [0.2.3]

### Changes

* Removed the [-n] option
* Bundle the and dependencies into **build/ffbetool.js** so the can be run without requiring `npm install`
* Refactored for maintainability
* Use ES6

## [0.2.2]

### New Features

* Added [-n] option to use the out filename format `$uid_$action`

### Changes

* Default out filename format to `unit_$action_$uid`

## [0.2.1]

### New Features

* Added [-e] option to include empty frames
* Added [-v] option to print out more information to console
* Added [-j] option to save the animation sheet information as json file

### Changes

* Fixed blend mode
* Some optimizations
* Recursively create directories to output path if necessary
* Print less to console by default
* Made the logs to console more informative

## [0.2.0]

### Changes

* Flip part image before applying rotation
* Some optimizations
* Removed the [-e] option to include empty frames
* Removed the [-d] divider option
* Promisification of callbacks

## [0.1.0]

### Notes

* Initial Release
