import {GLOW_FILTER} from "../core/init.js";

export  class TileSettings {
    static

    set_iso_walls_glowing(on = false, _walls = "") {
        let walls = new Set(_walls.split(","))
        canvas.walls.objects.children.forEach(y => y.filters = []);
        if (on) {
            canvas.walls.objects.children.filter(x => walls.has(x.document.id)).forEach(y => y.filters = [GLOW_FILTER])
        }
    }

    static

    _attachTileToWall(flag, notification, multiple, event) {
        event.preventDefault();
        if (!canvas.ready) return;
        const btn = event.currentTarget;
        const form = btn.form;
        const name = flagToName(flag);

        ui.notifications.info(notification);
        canvas.getLayerByEmbeddedName('Wall').activate()
        TileSettings.set_iso_walls_glowing(true, form[name].value)

        Hooks.once("controlWall", (wall) => {
            event.preventDefault();

            if ((form[name].value == "") || (multiple === false)) {
                form[name].value = wall.document._id;
            } else {
                form[name].value += "," + wall.document._id;
            }
            TileSettings.set_iso_walls_glowing(true, form[name].value)

            canvas.getLayerByEmbeddedName('Tile').activate();
            TileSettings.set_iso_walls_glowing(false)

            return false;
        });
    }

    static

    _clearAttachTileToWall(flag, event) {
        event.preventDefault();
        if (!canvas.ready) return;
        const btn = event.currentTarget;
        const form = btn.form;
        const name = flagToName(flag);
        form[name].value = "";
    }
}
function flagToName(flag) {
    return `flags.grape_juice-isometrics.${flag}`
}