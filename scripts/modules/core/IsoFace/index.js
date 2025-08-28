import {getBoolFlag, getValueFlag} from "../init.js";
import {register_handlebar_helpers} from "./handlebar_helpers.js";

export class IsoFace {
    token_isofaces_map

    constructor() {
        this.token_isofaces_map = new Map();
    }

    async destructor() {
        await this.unload_textures_for_assets();
    }

    calculateBearing(x1, y1, x2, y2) {
        // Use the original coordinates if x2 or y2 is null
        const endX = x2 === null ? x1 : x2;
        const endY = y2 === null ? y1 : y2;

        // Calculate the direction vector based on the input coordinates
        const deltaX = endX - x1;
        const deltaY = endY - y1;

        // Calculate the angle using the arctangent of deltaX divided by deltaY
        const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;

        // Convert angle to bearing (0 to 360 degrees)
        const bearing = ((angle + 360) % 360) + (45 * 6);

        // Round the bearing to the nearest multiple of 45 degrees
        const roundedBearing = Math.round(bearing / 45) * 45 % 360;

        return roundedBearing;
    }


    preUpdateToken(tokenDocument, change) {
        if (getBoolFlag(tokenDocument, 'isoface_enabled')) {
            const {x: newX = null, y: newY = null} = change;
            if (newX || newY) {
                const bearing = this.calculateBearing(tokenDocument.x, tokenDocument.y, newX, newY);
                change.rotation = bearing;
            }
        }
    }


    async updateToken(tokenDocument, change = {}) {
        //should update mask for fog and whatever as well
        if (getBoolFlag(tokenDocument, 'isoface_enabled')) {
            if (change?.hasOwnProperty('rotation')
                ||
                (change?.flags?.hasOwnProperty('grape_juice-isometrics') && change?.flags['grape_juice-isometrics']?.isoface)) {
                await this.setDirectionalLoadout(tokenDocument);
            }
        }
    }


    async setDirectionalLoadout(tokenDocument) {
        const isoFace = getValueFlag(tokenDocument, 'isoface');
        if (!isoFace) return;
        let mesh = tokenDocument.object.mesh;
        const direction = this.degreesToDirection(tokenDocument.rotation);
        const token_id = tokenDocument.id;
        const toggledLoadoutId = isoFace.toggledLoadoutId;
        let path = isoFace.loadouts[toggledLoadoutId].direction_images[direction];
        if (path) {
            // const texture = await this.setVideoLoadoutTexture(await PIXI.Assets.load(path));
            const texture = await PIXI.Assets.load(path);
            await this.setVideoLoadoutTextureNo(texture);
            if (texture.baseTexture) {
                mesh.texture = texture;
            }
        }
    }

    async setVideoLoadoutTextureNo(texture) {
        let video = game.video.getVideoSource(texture);
        if (video) {
            const playOptions = {volume: 0, autoplay: true};
            if (Number.isFinite(video.duration)) {
                playOptions.offset = Math.random() * video.duration;
            }
            game.video.play(video, playOptions);
        }
    }

    async setVideoLoadoutTexture(texture) {
        let video = game.video.getVideoSource(texture);
        if (video) {
            texture = await game.video.cloneTexture(video);
            video = game.video.getVideoSource(texture);
            const playOptions = {volume: 0, autoplay: true};
            if (Number.isFinite(video.duration)) {
                playOptions.offset = Math.random() * video.duration;
            }
            game.video.play(video, playOptions);
        }
        return texture
    }

    async canvasInit(canvas, onComplete, onStart) {


        // Step 1: Filter and map the placeables to get an array of [id, loadouts]
        const loadoutData = canvas.tokens.placeables
            .filter(t => getBoolFlag(t.document, 'isoface_enabled'))
            .map(x => [x, x.document.id, getValueFlag(x.document, 'isoface')?.loadouts]).filter(([a, b, loadouts]) => loadouts);

        // Step 2: Initialize an empty array to store all the promises

        // Step 3: Loop through each data entry ([id, loadouts]) and generate promises
        await this.load_texture_into_assets(loadoutData, onStart, onComplete);
    }

    async unload_textures_for_assets() {
        let loadoutData = canvas.tokens.placeables
            .filter(t => getBoolFlag(t.document, 'isoface_enabled'))
            .map(x => [x, x.document.id, getValueFlag(x.document, 'isoface')?.loadouts]).filter(([a, b, loadouts]) => loadouts);

        let promises = [];

        for (const [token, token_id, loadouts] of loadoutData) {
            for (const [loadoutId, loadout] of Object.entries(loadouts)) {
                const {direction_images} = loadout;

                for (const [direction, path] of Object.entries(direction_images)) {
                    if (!!path && !!direction) {
                        promises.push(PIXI.Assets.unload(path));
                    }
                }
            }


        }

        // Step 4: Wait for all promises to resolve using Promise.all
        try {
            await Promise.all(promises);
            console.log('All textures unloaded successfully.');
        } catch (error) {
            console.error('Error unloading some textures:', error);
        }
    }

    async load_texture_into_assets(loadoutData, onStart, onComplete) {
        let promises = [];

        for (const [token, token_id, loadouts] of loadoutData) {
            if (onStart) onStart(token);
            for (const [loadoutId, loadout] of Object.entries(loadouts)) {
                const {direction_images} = loadout;

                for (const [direction, path] of Object.entries(direction_images)) {
                    if (!!path && !!direction) {
                        promises.push(PIXI.Assets.load(path).then(async (a, b, c) => {
                            // If the loaded asset matches the current toggledLoadoutId and direction, call the setDirectionalLoadout method
                            const tokenDocument = canvas.tokens.placeables.find(t => t.document.id === token_id).document;
                            if (loadoutId === getValueFlag(tokenDocument, 'isoface').toggledLoadoutId) {
                                await this.setDirectionalLoadout(tokenDocument);
                                if (onComplete) onComplete(token);
                            }
                        }));
                    }
                }
            }


        }

        // Step 4: Wait for all promises to resolve using Promise.all
        try {
            await Promise.all(promises);
            console.log('All textures loaded successfully.');
        } catch (error) {
            console.error('Error loading some textures:', error);
        }
    }

    degreesToDirection(degrees) {
        const directions = ["SE", "S", "SW", "W", "NW", "N", "NE", "E"];

        const index = Math.round((degrees) / 45) % 8;
        return directions[index];
    }
}

// Register the IsoFaceConfig application
// Hooks.once("init", () => {
//     game.settings.registerMenu("grape_juice-isometrics-pro", "isoFaceConfig", {
//         name: "8-Direction Loading Image Settings",
//         label: "8-Direction Loading Image Settings",
//         hint: "Configure 8-Direction Loading Image Settings",
//         type: IsoFaceConfig,
//         restricted: true
//     });
// });

Hooks.once("init", () => {
    register_handlebar_helpers();
});
