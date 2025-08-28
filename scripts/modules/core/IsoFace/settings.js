import {IsoFaceStructure, TEXTURE_TYPE} from "./structure.js";
import {setValueFlag} from "../init.js";

export class IsoFaceConfig extends FormApplication {
    constructor(object, isoFace, tokenConfig = {}) {
        super(object, {});
        this.sheet = tokenConfig;

        this.placeHolderBear = Math.random() < 0.5;

        this.global_isoFace = isoFace;
        // this.object = object;
        this.isoface = isoFace.token_isofaces_map.get(object.id) || new IsoFaceStructure(object)//new IsoFaceStructure(object);

        // Initialize loadouts and selectedLoadout properties
        this.selectedLoadoutId = "default";
    }


    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "eight-direction-image-settings",
            title: "8-Direction Loading Image Settings",
            template: "/modules/grape_juice-isometrics-pro/templates/IsoFace/iso-face-config.html",
            width: 850,
            height: "auto",
            closeOnSubmit: true,
            submitOnChange: false,
            submitOnClose: true,
            resize: false,
            classes: ["sheet", "iso-face-config"],
        });
    }

    getData() {
        const data = super.getData();

        // Get the updated loadouts array and return a copy of it
        data.loadouts = this.isoface.loadouts;
        data.selectedLoadoutId = this.selectedLoadoutId;
        data.selectedLoadout = this.isoface.loadouts.get(this.selectedLoadoutId);
        data.cardinalLookup = ["NW", "N", "NE", "W", "MID", "E", "SW", "S", "SE"];
        data.toggledLoadoutId = this.isoface.toggledLoadoutId;
        return data;
    }

    // super.maximize()
    async close(options = {}) {
        // this._resetScenePreview();
        await this.sheet.maximize();
        return super.close(options);

    }

    async _updateObject(event, formData) {
        let loadouts = this.isoface.getObject()
        await setValueFlag(this.object, 'isoface', loadouts);
        this.isoface = new IsoFaceStructure(this.object);
        // this.toggledLoadoutId = a.toggledLoadoutId;
        this.global_isoFace.token_isofaces_map.set(this.object.id, this.isoface);

        // not sure i have to do this.
        // await this.global_isoFace.load_texture_into_assets([[null, this.object.id, loadouts.loadouts]])

        // this.isoface.updateToken(this.object)
        //probably needs to update the token map
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Add event listeners for the various buttons
        html.find('.gji_loadout-add').click(this._onAddLoadout.bind(this));
        html.find('.item-delete').click(this._onDeleteLoadout.bind(this));
        html.find('.gji_loadout-row').click(this._onSelectLoadout.bind(this));
        html.find('.item-edit').click(this._onEditLoadoutName.bind(this));
        html.find('.item-toggle').click(this._onToggleLoadout.bind(this));
        html.find('.gji-load-image').click(this._onLoadImage.bind(this));

        let ShouldBear = this.placeHolderBear;
        html.find('.gji_direction-image').bind("error", function (event) {
            let direction = event.target.attributes['data-image-id'].value;
            const name = ShouldBear ? "bear" : "default";
            event.target.src = `/modules/grape_juice-isometrics-pro/scripts/modules/core/IsoFace/assets/${name}_isoface/${name}_${direction}.svg`
            event.onerror = null
            event.target.style.opacity = '30%';
        })
        // html.find('.gji_center-image').bind("error", function (event) {
        //     event.target.src = "https://placebear.com/200/200"
        //     event.onerror = null
        // })


    }

    createVideoElement(imageElement) {
        const newVideo = document.createElement("video");
        const newSource = document.createElement("source");
        newSource.src = imageElement.src;
        for (let index = imageElement.attributes.length - 1; index > -1; --index) {

            let attribute = imageElement.attributes[index];
            newSource.setAttribute(attribute.name, attribute.value);
            newVideo.setAttribute(attribute.name, attribute.value);
        }
        newVideo.muted = true;
        newVideo.autoplay = true;
        newVideo.loop = true;
        newVideo.appendChild(newSource);
        newVideo.onclick = (this._onLoadImage.bind(this));

        return newVideo;
    }

    createImageElement(imageElement) {
        const newSource = document.createElement("img");
        newSource.src = imageElement.src;
        for (let index = imageElement.attributes.length - 1; index > -1; --index) {

            let attribute = imageElement.attributes[index];
            newSource.setAttribute(attribute.name, attribute.value);
        }
        newSource.onclick = (this._onLoadImage.bind(this));

        return newSource;
    }

    async openImageFileDialog(imageElement) {
        const filePickerOptions = {
            type: "imagevideo", callback: (path, a, b, c) => {
                imageElement.src = path;
                imageElement.style.opacity = '100%';

                let element;
                if (VideoHelper.hasVideoExtension(path)) {
                    element = this.createVideoElement(imageElement);
                } else {
                    element = this.createImageElement(imageElement);

                }
                if (imageElement.tagName === 'SOURCE') {
                    imageElement = imageElement.parentNode;
                }

                imageElement.replaceWith(element);
                this.updateSettings(imageElement, path);
            },
        };

        return await new FilePicker(filePickerOptions).browse();
    }

    async _onAddLoadout(event) {
        event.preventDefault();

        // Generate a unique name for the new loadout
        const loadoutName = `New Loadout ${this.isoface.loadouts.size}`;

        // Add the new loadout to the loadouts array
        this.isoface.createNewLoadout(TEXTURE_TYPE.IMAGE, loadoutName);

        // Update the form to show the new loadout in the list
        await super.render();
    }

    async _onDeleteLoadout(event) {
        event.preventDefault();

        // Get the loadout ID from the clicked delete button
        const loadoutId = event.currentTarget.dataset.loadoutId;

        // Remove the loadout from the loadouts array
        this.isoface.loadouts.delete(loadoutId);

        // Update the form to remove the loadout from the list
        await super.render();
    }

    async _onSelectLoadout(event) {
        // Get the loadout ID from the clicked edit button
        const loadoutId = event.currentTarget.dataset.loadoutId;
        this.selectedLoadoutId = loadoutId;

        await super.render();

    }

    async _onEditLoadoutName(event) {
        event.preventDefault();

        // Get the loadout ID from the clicked edit button
        const loadoutId = event.currentTarget.dataset.loadoutId;

        // Find the loadout with the given ID
        const loadout = this.isoface.loadouts.get(loadoutId);

        if (loadout) {
            // Prompt the user to enter a new name for the loadout
            const newName = await new Promise(resolve => {
                new Dialog({
                    title: "Edit Loadout Name",
                    content: `<form><input type="text" name="newName" value="${loadout.name}"></form>`,
                    buttons: {
                        ok: {
                            label: "Save", callback: (html) => resolve(html.find("input[name='newName']").val().trim())
                        }, cancel: {
                            label: "Cancel", callback: () => resolve(null)
                        }
                    },
                    default: "ok"
                }).render(true);
            });

            // Update the loadout name if the user entered a new name
            if (newName) {
                loadout.name = newName;
                await super.render();
            }
        }
    }

    async _onLoadImage(event) {
        event.preventDefault();

        const button = event.currentTarget;
        const imageElement = button.closest('.gji_image-wrapper').querySelector('.gji_direction-image');

        if (imageElement) {
            await this.openImageFileDialog(imageElement);

        }
    }

    async _onToggleLoadout(event) {
        event.preventDefault();
        const loadoutId = event.currentTarget.dataset.loadoutId;
        this.isoface.toggledLoadoutId = loadoutId;
    }

    updateSettings(imageElement, path) {
        const direction = imageElement.attributes['data-image-id'].value;
        const currentLoadout = this.isoface.loadouts.get(this.selectedLoadoutId)
        currentLoadout.direction_images[direction] = path;
        // this.isoface.loadouts.set(this.selectedLoadoutId)
        // Implement center image updating and border highlighting here
        // Save the new image source to your settings storage
    }

}