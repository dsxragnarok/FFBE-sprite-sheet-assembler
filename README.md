# FFBE-sprite-sheet-assembler
Tool to assemble Final Fantasy Brave Exvius sprite sheets.

Takes the a master sprite atlas png file and uses the information from cvs files
to assemble the sprite sheet.

## Instructions

* Requires [nodejs](https://nodejs.org/en/)

`npm install`

### Usage
```
node main num [-a anim] [-c columns] [-i inDir] [-o outDir]

```
* num: (required) the unit ID number
* -a: the animation name (ie. atk, idle, dead, win, etc.)
* -c: the number of columns in the sheet, if not specified the output will be a single-row strip
* -i: the input path, defaults to current directory
* -o: the output path, defaults to current directory


### References
* Code based off of puggsoy's [FFBETool](https://github.com/puggsoy/MiscTools/tree/master/FFBETool/src)
* Original python code for Brave Frontier from [pastebin](http://pastebin.com/vXc0yNRh)
* Information gleaned from: [The VG Resource](https://www.google.com/url?sa=t&rct=j&q=&esrc=s&source=web&cd=9&cad=rja&uact=8&ved=0ahUKEwjU8bHRxsfOAhVL62MKHT6xCLwQFgg5MAg&url=http%3A%2F%2Fwww.vg-resource.com%2Fthread-27841.html&usg=AFQjCNHXVA5Jn78-QtXtJAtpmuZoEAxr_g&sig2=M6vg5hTSpyOJUD2qMuIUsQ&bvm=bv.129759880,d.cGc)

