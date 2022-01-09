# bitpacker - a simple package manager for Bitburner

## installation from bitburner terminal:

wget "ht<span/>tps://raw.githubusercontent.com/davidsiems/bitpacker/live/command/dist/bitpacker.js" /bitpacks/bitpacker.js; alias bp="run /bitpacks/bitpacker.js"

## get started:

    bp add some-cool-package     // adds some-cool-package
    bp remove some-cool-package  // removes some-cool-package
    bp list                      // lists installed packages and their versions
    bp install                   // makes /bitpacks reflect what's in the manifest (packages.txt)
    bp cleanslate                // uninstalls all packages and resets bitman.txt

## develop a package:

    bp create /path/to/my-package my-package-name  // initalizes /path/to/my-package with a new package named my-package-name
    bp publish /path/to/my-package                 // publishes the package in /path/to/my-package to the registry

## learn more:

    bp help                   // prints command usage to the console
    bp man some-cool-package  // prints out manual.txt associated with a some-cool-package (if it exists)

## hate it? uninstall from the terminal:

    bp cleanslate; rm packages.txt; rm /bitpacks/bitpacker.js

## need help?:

@degaz on [Discord](https://discord.gg/TFc3hKD)

## how it works:

Bitpacker operates on a manifest called **packages.txt** that must be located in the root of the host you run it on.
Bitpacker will create and manage this file by default, but you can also edit it by hand.

Packages are installed under **/bitpacks** and the list of packages and their versions is tracked in **packages.txt**.

Each time a package is published a new version of the package is created.

Bitpacker does not manage dependencies between packages and it's recommended that you avoid them.

Packages must include a **package.txt** file which you can edit to add additional metadata for your package. You may also may
also include a **manual.txt** file which will be displayed to users when the **bp man** command is run.
