# FFBE-sprite-sheet-assembler
Tool to assemble Final Fantasy Brave Exvius sprite sheets.

Takes the a master sprite atlas png file and uses the information from cvs files
to assemble the sprite sheet.

## Instructions

* Requires [nodejs](https://nodejs.org/en/)

`npm install && npm run build`

### Usage
```
node build/ffbetool.js num [-a anim] [-c columns] [-e] [-v] [-j] [-g] [-i inDir] [-o outDir]

```
* **num:** (required) the unit ID number, must be the first argument.
* **-a:** The animation name (ie. atk, idle, dead, win, etc.).
* **-c:** The number of columns in the sheet, if not specified the output will be a single-row strip.
* **-e:** If this option is included, the strips will include any empty frames. By default empty frames are excluded.
* **-v:** If this option is included, more information will be printed to console.
* **-j:** This option saves the sheet information in json format saved as a .json file.
* **-g:** If this option is included, an animated gif will also be outputed.
* **-i:** The input path, defaults to current directory.
* **-o:** The output path, defaults to current directory.

> More [detailed instructions](./documentation/instructions.md)

### References
* Code based off of puggsoy's [FFBETool](https://github.com/puggsoy/MiscTools/tree/master/FFBETool/src)
* Original python code for Brave Frontier from [pastebin](http://pastebin.com/vXc0yNRh)
* Information gleaned from: [The VG Resource](https://www.google.com/url?sa=t&rct=j&q=&esrc=s&source=web&cd=9&cad=rja&uact=8&ved=0ahUKEwjU8bHRxsfOAhVL62MKHT6xCLwQFgg5MAg&url=http%3A%2F%2Fwww.vg-resource.com%2Fthread-27841.html&usg=AFQjCNHXVA5Jn78-QtXtJAtpmuZoEAxr_g&sig2=M6vg5hTSpyOJUD2qMuIUsQ&bvm=bv.129759880,d.cGc)
