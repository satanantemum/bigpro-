export function register_handlebar_helpers(){
    Handlebars.registerHelper('gji_ifCond', function (v1, v2, options) {
        if (v1 === v2) {
            return options.fn(this);
        }
        return options.inverse(this);
    });

    // Handlebars.registerHelper('mul', function (a, b) {
    //     return a * b;
    // });

       Handlebars.registerHelper('gji_ifVideo', function (a, options) {
           if (VideoHelper.hasVideoExtension(a)){
               return options.fn(this)
           }
           return options.inverse(this);

       });


    Handlebars.registerHelper('gji_eachLoop', function (n, options) {
        let buffer = '';
        for (let i = 0; i < n; ++i) {
            buffer += options.fn.call(this, i, {...options, data: options.data});
        }
        return buffer;
    });

    Handlebars.registerHelper('gji_range', function (start, end) {
        const result = [];
        for (let i = start; i < end; i++) {
            result.push(i);
        }
        return result;
    });
    // Handlebars.registerHelper('add', function (a, b) {
    //     return a + b;
    // });

    Handlebars.registerHelper("gji_meach", function (contexts, options) {

        // Throw a runtime exception if options were not supplied.
        if (!options) {
            throw new Handlebars.Exception("Must pass iterator to #each");
        }

        // If the "list of contexts" is a function, execute it to get the actual list of contexts.
        if (typeof contexts === "function") {
            contexts = contexts.call(this);
        }

        // If data was supplied, frame it.
        const data = options.data ? Object.assign({}, options.data, {_parent: options.data}) : undefined;

        // Create the string into which the contexts will be handled and returned.
        let string = "";

        // Create a flag indicating whether or not string building has begun.
        let stringExtensionStarted = false;

        // Create a variable to hold the context to use during the next string extension. This is done to
        // allow iteration through the supplied list of contexts one step out of sync as they are looped
        // through later in this helper, ensuring a predictable sequence of value retrieval, string
        // extension, value retrieval, string extension...
        let nextContext;

        // Create a function responsible for expanding the string.
        const extendString = (final = false) => {

            // If other contexts have been encountered...
            if (nextContext) {

                // Expand the string using the block function.
                string += options.fn(nextContext.value, {
                    data: data ? Object.assign(data, {
                        index: nextContext.index, key: nextContext.key, first: !stringExtensionStarted, last: final
                    }) : undefined, blockParams: [nextContext.key, nextContext.value]
                });

                // Note that string extension has begun.
                stringExtensionStarted = true;

                // If no contexts have been encountered and this is the final extension...
            } else if (final) {

                // Expand the string using the "else" block function.
                string += options.inverse(this);

            }

        };

        // If a list of contexts was supplied...
        if (contexts !== null && typeof contexts !== "undefined") {

            // Start a counter.
            let index = 0;

            // If an array list was supplied...
            if (Array.isArray(contexts)) {

                // For each of the possible indexes in the supplied array...
                for (const len = contexts.length; index < len; index++) {

                    // If the index is in the supplied array...
                    if (index in contexts) {

                        // Call the string extension function.
                        extendString();

                        // Define the context to use during the next string extension.
                        nextContext = {
                            index: index, key: index, value: contexts[index]
                        };

                    }

                }

                // If a map list was supplied...
            } else if (contexts instanceof Map) {

                // For each entry in the supplied map...
                for (const [key, value] of contexts) {

                    // Call the string extension function.
                    extendString();

                    // Define the context to use during the next string extension.
                    nextContext = {
                        index: index, key: key, value: value
                    };

                    // Increment the counter.
                    index++;

                }

                // If an iterable list was supplied (including set lists)...
            } else if (typeof contexts[Symbol.iterator] === "function") {

                // Get an iterator from the iterable.
                const iterator = contexts[Symbol.iterator]();

                // Create a variable to hold the iterator's next return.
                let next;

                // Do the following...
                do {

                    // Iterate and update the variable.
                    next = iterator.next();

                    // If there is anything left to iterate...
                    if (!next.done) {

                        // Call the string extension function.
                        extendString();

                        // Define the context to use during the next string extension.
                        nextContext = {
                            index: index, key: index, value: next.value
                        };

                        // Increment the counter.
                        index++;

                    }

                    // ... until there is nothing left to iterate.
                } while (!next.done);

                // If a list other than an array, map, or iterable was supplied...
            } else {

                // For each key in the supplied object...
                for (const key of Object.keys(contexts)) {

                    // Call the string extension function.
                    extendString();

                    // Define the context to use during the next string extension.
                    nextContext = {
                        index: index, key: key, value: contexts[key]
                    };

                    // Increment the counter.
                    index++;

                }

            }

        }

        // Call the string extension a final time now that the last supplied context has been encountered.
        extendString(true);

        // Return the fully-extended string.
        return string;

    });
}