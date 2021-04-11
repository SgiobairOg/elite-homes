const { ungzip } = require('node-gzip');
const got = require('got');
const AsciiTable = require('ascii-table');
const cliProgress = require('cli-progress');
const Spinner = require('cli-spinner').Spinner;
const chalk = require('chalk');

Object.defineProperty(Array.prototype, "tap", { value(f) { f(this); return this; }});

const referenceSystems = {
    'RHEA': {
        name: 'Rhea',
        coords: {'x': 58.125, 'y': 22.59375, 'z': -28.59375},
    },
    '26 ALPHA MONOCEROTIS': {
        name: '26 Alpha Monocerotis',
        coords: {'x': 108.28125, 'y': 17.9375, 'z': -98.96875}
    }
};

const preferences = {
    population: 1,
    factionMax: 6,
    referenceSystem: '26 ALPHA MONOCEROTIS',
    referenceRange: 50,
}

const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '{message} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} mb'
}, cliProgress.Presets.shades_grey)


const isWithinRangeOf = function(system, reference, range) {
    const distance = Math.sqrt( 
        Math.pow((system.coords.x - reference.coords.x), 2) + 
        Math.pow((system.coords.y - reference.coords.y), 2) + 
        Math.pow((system.coords.z - reference.coords.z), 2));
    
    return distance <= range;
}

const freeOfPlayerFactions = function( system ) {
    const {name, factions} = system;
    if(!factions) return true;
    const playerFactions = factions
        .filter(faction => faction.isPlayer)
    if(playerFactions.length > 0) console.info(`  X - ${name} has ${playerFactions.length} player faction(s)`)
    return playerFactions.length === 0;
}

const hasLargePad = function( system, largeStationNameData ) {
    const systemStationNames = system.stations.map( station => station.name )
    const hasLargePad = systemStationNames.some( name => largeStationNameData.includes(name))
    if(!hasLargePad) console.info(`  X - ${system.name} has no large landing pads`)
    return hasLargePad
}

const hasNoPermit = function( system, systemsPermitData ) {
    return !systemsPermitData.find(systemData => system.id === systemData.id).needsPermit
}

const factionsWithinLimits = function( factions, maxFactions) {
    if(!factions) return true;
    const validFactions = factions
        .filter(faction => faction.influence > 0.001)
    return validFactions.length <= maxFactions
}

async function getEDSMPopulatedSystems() {
    try {
        const progressBar1 = multibar.create(100,0, {message: 'Populated Systems Data from EDSM'});
        //console.log('Retrieving Populated Systems Data from EDSM');
        const { body } = await got(
            'https://www.edsm.net/dump/systemsPopulated.json.gz', {
                responseType: 'buffer',
            })
            .on('downloadProgress', progress => {
                progressBar1.setTotal(Math.floor(progress.total/1000000));
                progressBar1.update(Math.floor(progress.transferred/1000000));
            })
        const spinner = new Spinner('%s Decompressing data...')
        spinner.setSpinnerString(27)
        spinner.start()
        const decompressedData = (await ungzip(body)).toString();
        spinner.stop()
        console.log('Data decompressed.')

        return JSON.parse(decompressedData);
    } catch (error) {
        console.error(error);
    }
};

async function getEDDBPopulatedSystems() {
    try {
        const progressBar2 = multibar.create(100,0, {message: 'Populated Systems Data from EDDB'});
        //console.log('Retrieving Populated Systems Data from EDDB');
        const { body } = await got(
            'https://eddb.io/archive/v6/systems_populated.json', {
                responseType: 'json',
            })
            .on('downloadProgress', progress => {
                progressBar2.setTotal(Math.floor(progress.total/1000000));
                progressBar2.update(Math.floor(progress.transferred/1000000));
            })

        return body
            .map(system => ({'id': system['edsm_id'], 'needsPermit': system['needs_permit']}) );
    } catch (error) {
        console.error(error);
    }
}

async function getLargeStationNames() {
    try {
        const progressBar3 = multibar.create(100, 0, {message: 'Large Stations Data'});
        //console.log('Retrieving Large Stations Data');
        const { body } = await got(
            'https://eddb.io/archive/v6/stations.json', {
                responseType: 'json',
            })
            .on('downloadProgress', progress => {
                progressBar3.setTotal(Math.floor(progress.total/1000000));
                progressBar3.update(Math.floor(progress.transferred/1000000));
            })

        return body
            .filter(station => station['max_landing_pad_size'] === 'L')
            .map(station => station.name);
    } catch (error) {
        console.error(error);
    }
}

async function hunt() {
    const getStations = getLargeStationNames();
    const getSystemsPermitData = getEDDBPopulatedSystems();
    const getPopulatedSystems = getEDSMPopulatedSystems();
    const [stations, systemsPermitData, populatedSystems] =[
        await getStations,
        await getSystemsPermitData,
        await getPopulatedSystems
    ];
    const referenceSystem = referenceSystems[preferences.referenceSystem];
    const outputTable = new AsciiTable('Prospect Systems');

    outputTable.setHeading(' ', 'name', 'allegiance', 'population', 'factions', 'stations');
    outputTable.removeBorder();
    outputTable.setHeadingAlign('left')

    console.info(`Processing ${populatedSystems.length} systems...`)

    populatedSystems
        .tap( () => console.info(`Filtering for systems within ${preferences.referenceRange}Ly of ${referenceSystem.name}...`))
        .filter( system => isWithinRangeOf(system, referenceSystem, preferences.referenceRange))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out Pilot Federation Systems...`))
        .filter( system => system.allegiance !== 'Pilots Federation')
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering for systems with more than ${preferences.population} population...`))
        .filter( system => system.population >= preferences.population)
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out systems with player factions...`))
        .filter( system => freeOfPlayerFactions(system))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering for systems with fewer than ${preferences.factionMax} factions...`))
        .filter( system => factionsWithinLimits(system.factions, preferences.factionMax))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out systems without large landing pads...`))
        .filter( system => hasLargePad(system, stations))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out systems requiring permits...`))
        .filter( system => hasNoPermit(system, systemsPermitData))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .forEach( (system, index) => {
            const { name, allegiance, population, factions } = system;
            outputTable.addRow(`${index+1}.`, name, allegiance, population, factions.filter(faction => faction.influence > 0.001).length)
        });

    console.log(`\n${outputTable.toString()}`);
    process.exit(0)
};

hunt();
