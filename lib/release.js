'use strict';

const jsonfile = require('jsonfile');
const semver = require('semver');
const child = require('child_process');
const fs = require('fs');
const path = require('path');

function isRepoClean() {
  return child.execSync('git status -s').length === 0;
}

function createNewVersion(version, release) {
  return semver.inc(version, release);
}

function writeNewPackageJson(pkg, version) {
  pkg.version = version;
  jsonfile.writeFileSync(path.join(process.cwd(), 'package.json'), pkg, { spaces: 2 });
}

function startRelease(version) {
  child.execSync('git checkout develop');
  child.execSync('git flow release start ' + version);
}

function finishRelease(version) {
  return new Promise(resolve => {
    child.execSync('git add .');
    child.execSync('git commit -am "New release v' + version + '"');
    child.execSync('GIT_MERGE_AUTOEDIT=no git flow release finish -m "Released" ' + version);
    resolve(version);
  });
}

function updateRemote() {
  child.execSync('git push --all');
  child.execSync('git push --tags');
}

function getCurrentVersion() {
  return new Promise((resolve, reject) => {
    require('readline').createInterface({
      input: require('fs').createReadStream(path.join(process.cwd(), 'pom.xml'), {encoding: 'utf-8', autoClose: true})
    })
      .on('line', function (line) {
        var m = line.match(/^\s+<version>(\d+\.\d+\.\d+).*<\/version>$/);
        if (m) {
          resolve(m[1]);
        }
      })
      .on('close', () => {
        reject('Unable to find version in pom.xml');
      });
  });
}

function writeNewPomXml(version) {
  let p1 = new Promise(resolve => {
    let newPom = fs.createWriteStream(path.join(process.cwd(), 'pom.xml.new'), {encoding: 'utf-8'});
    let rl = require('readline').createInterface({
      input: fs.createReadStream(path.join(process.cwd(), 'pom.xml'), {encoding: 'utf-8', autoClose: true})
    });

    let replaced = false; // Only replace first occurence
    rl.on('line', function (line) {
      if (!replaced) {
        var m = line.match(/^\s+<version>(\d+\.\d+\.\d+).*<\/version>$/);
        if (m) {
          newPom.write(`  <version>${version}</version>\n`);
          replaced = true;
        } else {
          newPom.write(`${line}\n`);
        }
      } else {
        newPom.write(`${line}\n`);
      }
    });

    rl.on('close', () => {
      newPom.close();
      resolve();
    });
  });

  return new Promise(resolve => {
    p1.then(() => {
      fs.unlink(path.join(process.cwd(), 'pom.xml'), err => {
        if (err) { throw err; }
        fs.rename(path.join(process.cwd(), 'pom.xml.new'), path.join(process.cwd(), 'pom.xml'), err2 => {
          if (err2) { throw err2; }
          resolve(version);
        });
      });
    });
  });
}

function releaseMaven(releaseType) {
  return getCurrentVersion()
    .then(v => {
      return createNewVersion(v, releaseType);
    })
    .then(v => {
      startRelease(v);
      return writeNewPomXml(v);
    })
    .then(v => {
      return finishRelease(v);
    }).catch(err => {
      console.log('err', err);
    });
}

function release(fileType, releaseType, push) {
  return new Promise((resolve, reject) => {
    if (!isRepoClean()) {
      reject('Repository is not clean! Cannot release!');
    }

    if (fileType === 'maven') {
      releaseMaven(releaseType)
        .then(v => {
          if (push) {
            updateRemote();
          }

          resolve(v);
        });
    }
    else if (fileType === 'node') {
      var pkg = require(path.join(process.cwd(), 'package.json'));
      var v = createNewVersion(pkg.version, releaseType);

      startRelease(v);
      writeNewPackageJson(pkg, v);
      finishRelease(v).then(v => {
        if (push) {
          updateRemote();
        }
        resolve(v);
      });
    }
    else {
      reject('Unsupported fileType. Specify either node or maven');
    }
  });
}

module.exports = release;
