const verbose = false

//function for requiring with try catch
//by DaniGuardiola
//https://stackoverflow.com/questions/13197795/handle-errors-thrown-by-require-module-in-node-js/34005010#34005010
function requireF(modulePath){ // force require
    try {
        return require(modulePath);
    }
    catch (e) {
		console.log(`requireF():`)
        console.log(`The file "${modulePath}".js could not be loaded.`);
        console.log(`Try running "npm install ${modulePath} --save"`);
        process.exit(1);
    }
}

//load required
const { ungzip } = requireF('node-gzip');
const got = require('got');
const AsciiTable = require('ascii-table');
const cliProgress = require('cli-progress');
const Spinner = require('cli-spinner').Spinner;
const chalk = require('chalk');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

//CVS writer formating
const csvWriter = createCsvWriter({
    path: 'reports/populated-systems.csv',
    header: [
        {id: 'index', title: ' '},
        {id: 'name', title: 'Name'},
        {id: 'allegiance', title: 'Allegiance'},
        {id: 'population', title: 'Population'},
        {id: 'factions', title: 'Faction Count'},
        {id: 'stations', title: 'Orbital Stations'},
        {id: 'surfaceStations', title: 'Surface Stations'}
    ]
});

Object.defineProperty(Array.prototype, "tap", { value(f) { f(this); return this; }});

//Chose the refrence systems from which the search will start
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

//Choose the requirements for the systems we are looking for
const preferences = {
    population: 1,
    factionMax: 6,
    referenceSystemsRanges: {
		'26 ALPHA MONOCEROTIS': 100,
		'RHEA': 80,
	},
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

//Calculates if a planet is within one of multiple ranges
const isWithinMultileRanges = function(system, refrence_systems, ranges)
{
	is_in_range = false;
	
	for(var sys_id in refrence_systems)
	{
		is_in_range = isWithinRangeOf(system,referenceSystems[refrence_systems[sys_id]],ranges[sys_id]);
		if (is_in_range) break;
	}
	//Loop through the systems checking if they are in raneg.	
	return is_in_range;
}

const freeOfPlayerFactions = function( system ) {
    const {name, factions} = system;
    if(!factions) return true;
    const playerFactions = factions
        .filter(faction => faction.isPlayer)
    //if(playerFactions.length > 0) console.info(`  X - ${name} has ${playerFactions.length} player faction(s)`)
    return playerFactions.length === 0;
}

const hasLargePad = function( system, largeStationNameData ) {
    const systemStationNames = system.stations.map( station => station.name )
    const hasLargePad = systemStationNames.some( name => largeStationNameData.includes(name))
    //if(!hasLargePad) console.info(`  X - ${system.name} has no large landing pads`)
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
        console.log('');
        const spinner = new Spinner('%s Decompressing data...')
        spinner.setSpinnerString(27)
        spinner.start()
        const decompressedData = (await ungzip(body)).toString();
        spinner.stop()
        console.log('');
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
	
	//Get the systems that are going to be checked
	const usedRefrenceSystems = Object.keys(preferences.referenceSystemsRanges);
	
	if (verbose) console.log(`Refrence systens: ${usedRefrenceSystems}`);
	
	var refrenceRanges = []
	//And the ranges for the systems in the same order
	for (const star_system in usedRefrenceSystems) {
		if (verbose) console.log(`Distance to ${usedRefrenceSystems[star_system]}:` +
			`${preferences.referenceSystemsRanges[usedRefrenceSystems[star_system]]}`);
		refrenceRanges.push(
			preferences.referenceSystemsRanges[usedRefrenceSystems[star_system]]);
	}
	
	if (verbose) console.log(`Refrence ranges: ${refrenceRanges}`);
	
	//Output format
    const outputTable = new AsciiTable('Prospect Systems');

    outputTable.setHeading(' ', 'name', 'allegiance', 'population', 'factions', 'stations');
    outputTable.removeBorder();
    outputTable.setHeadingAlign('left')

    console.info(`Processing ${populatedSystems.length} systems...`)

    const data = populatedSystems
        .tap( () => console.info(`Filtering for systems within ${refrenceRanges}Ly of ${usedRefrenceSystems} respectively...`))
        .filter( system => isWithinMultileRanges(system, usedRefrenceSystems, refrenceRanges))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out Pilot Federation Systems...`))
        .filter( system => system.allegiance !== 'Pilots Federation')
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering for systems with more than ${preferences.population} population...`))
        .filter( system => system.population >= preferences.population)
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        /*.tap( () => console.info(`Filtering out systems with player factions...`))
        .filter( system => freeOfPlayerFactions(system))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering for systems with fewer than ${preferences.factionMax} factions...`))
        .filter( system => factionsWithinLimits(system.factions, preferences.factionMax))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        */.tap( () => console.info(`Filtering out systems without large landing pads...`))
        .filter( system => hasLargePad(system, stations))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .tap( () => console.info(`Filtering out systems requiring permits...`))
        .filter( system => hasNoPermit(system, systemsPermitData))
        .tap( list => console.info(`Filter complete, ${list.length} systems remaining.`))
        .sort( (systemA, systemB) => systemA.population - systemB.population)
        .map((system, index) => {
            const { name, allegiance, population, factions, stations } = system;
            return { 
                index: index+1,
                name,
                allegiance,
                population,
                factions: factions.filter(faction => faction.influence > 0.001).length,
                stations: stations.filter(station => station.type !== 'Planetary Outpost').length,
                surfaceStations: stations.filter(station => station.type === 'Planetary Outpost').length
            }
        });
        
    data.forEach( (system) => {
            const { index, name, allegiance, population, factions, stations, surfaceStations } = system;
            outputTable.addRow(`${index}`, name, allegiance, population, factions, stations, surfaceStations)
        });

    console.log(data[0])

    console.log(populatedSystems[1702].stations)
    
    //Make sure to add the reports folder if it does not already exist
    if (!fs.existsSync("reports")){
        fs.mkdirSync("reports");
    }
    
	//TODO: add a check to see if file is already opened for writing
    await csvWriter
        .writeRecords(data)
        .then(()=> console.log('The CSV file was written successfully'));

    //console.log(`\n${outputTable.toString()}`);
    process.exit(0)
};

hunt();
