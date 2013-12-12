var jsplot = (function (module) {
    module.Axes3D = function(figure) {
        if (this.canvas === undefined) {
            module.Axes.call(this, figure);
            this.canvas = $(document.createElement("canvas"));
            this.object.appendChild(this.canvas[0]);
        }

        // scene and camera
        this.camera = new THREE.CombinedCamera( this.canvas.width(), this.canvas.height(), 45, 1.0, 1000, 1., 1000. );
        this.camera.up.set(0,0,1);
        this.camera.position.set(0, -500, 0);
        this.camera.lookAt(new THREE.Vector3(0,0,0));
        
        //These lights approximately match what's done by vtk
        this.lights = [new THREE.DirectionalLight( 0xffffff ), new THREE.DirectionalLight(0xffffff), new THREE.DirectionalLight(0xffffff)];
        this.lights[0].position.set( 1, -1, -1 ).normalize();
        this.lights[1].position.set( -1, -.25, .75 ).normalize();
        this.lights[2].position.set( 1, -.25, .75 ).normalize();
        this.lights[0].intensity = .47;
        this.lights[1].intensity = .29;
        this.lights[2].intensity = .24;
        this.camera.add( this.lights[0] );
        this.camera.add( this.lights[1] );
        this.camera.add( this.lights[2] );

        this.views = [];

        // renderer
        this.renderer = new THREE.WebGLRenderer({ 
            alpha:false,
            antialias: true, 
            preserveDrawingBuffer:true, 
            canvas:this.canvas[0],
        });
        this.renderer.setClearColor(new THREE.Color(0, 0, 0));
        this.renderer.setSize( this.canvas.width(), this.canvas.height() );
        this.renderer.sortObjects = false;

        this.state = "pause";
        this._startplay = null;
        this._animation = null;

        //Figure registrations
        this.figure.register("playsync", this, function(time) {
            if (this._startplay != null)
                this._startplay = (new Date()) - (time * 1000);
        });
        this.figure.register("playtoggle", this, this.playpause.bind(this));
        this.figure.register("setFrame", this, this.setFrame.bind(this));
    }
    module.Axes3D.prototype = Object.create(module.Axes.prototype);
    module.Axes3D.prototype.constructor = module.Axes3D;
    module.Axes3D.prototype.resize = function(width, height) {
        if (width !== undefined) {
            $(this.object).find("#brain, #roilabels").css("width", width);
            width = $(this.object).width();
        }
        var w = width === undefined ? $(this.object).width()  : width;
        var h = height === undefined ? $(this.object).height()  : height;
        var aspect = w / h;

        this.width = w;
        this.height = h;

        this.renderer.setSize( w * dpi_ratio, h * dpi_ratio );
        this.renderer.domElement.style.width = w + 'px'; 
        this.renderer.domElement.style.height = h + 'px'; 

        this.camera.setSize(aspect * 100, 100);
        this.camera.updateProjectionMatrix();
        this.dispatchEvent({ type:"resize", width:w, height:h});
        this.loaded.done(this.schedule.bind(this));
    };
    module.Axes3D.prototype.schedule = function() {
        if (!this._scheduled) {
            this._scheduled = true;
            requestAnimationFrame( function() {
                this.draw();
                if (this.state == "play" || this._animation != null) {
                    this.schedule();
                }
            }.bind(this));
        }
    };
    module.Axes3D.prototype.draw = function () {
        var now = new Date();
        if (this.state == "play")
            this.setFrame((now - this._startplay) / 1000);
        
        if (this._animation) {
            var atime = (now - this._animation.start) / 1000;
            if (!(this._animate(atime)))
                delete this._animation;
        }

        var view, left, bottom, width, height;
        if (this.views.length > 1) {
            for (var i = 0; i < this.views.length; i++) {
                view = this.views[i];
                left   = Math.floor( this.width  * view.left );
                bottom = Math.floor( this.height * view.bottom );
                width  = Math.floor( this.width  * view.width );
                height = Math.floor( this.height * view.height );

                this.renderer.setViewport( left, bottom, width, height );
                this.renderer.setScissor( left, bottom, width, height );
                this.renderer.enableScissorTest ( true );

                this.camera.aspect = width / height;
                this.camera.updateProjectionMatrix();
                this.drawView(this.views[i].scene, i);
            }
        } else {
            this.renderer.enableScissorTest(false);
            this.drawView(this.views[0].scene, 0);
        }
        this._scheduled = false;
        this.dispatchEvent({type:"draw"});
    };
    module.Axes3D.prototype.drawView = function(scene) {
        this.renderer.render(scene, this.camera);
    };
    module.Axes3D.prototype.animate = function(animation) {
        var state = {};
        var anim = [];
        animation.sort(function(a, b) { return a.idx - b.idx});
        for (var i = 0, il = animation.length; i < il; i++) {
            var f = animation[i];
            if (f.idx == 0) {
                this.setState(f.state, f.value);
                state[f.state] = {idx:0, val:f.value};
            } else {
                if (state[f.state] === undefined)
                    state[f.state] = {idx:0, val:this.getState(f.state)};
                var start = {idx:state[f.state].idx, state:f.state, value:state[f.state].val}
                var end = {idx:f.idx, state:f.state, value:f.value};
                state[f.state].idx = f.idx;
                state[f.state].val = f.value;
                if (start.value instanceof Array) {
                    var test = true;
                    for (var j = 0; test && j < start.value.length; j++)
                        test = test && (start.value[j] == end.value[j]);
                    if (!test)
                        anim.push({start:start, end:end, ended:false});
                } else if (start.value != end.value)
                    anim.push({start:start, end:end, ended:false});
            }
        }
        if (this.active.fastshader) {
            this.meshes.left.material = this.active.fastshader;
            this.meshes.right.material = this.active.fastshader;
        }
        this._animation = {anim:anim, start:new Date()};
        this.schedule();
    };
    module.Axes3D.prototype._animate = function(sec) {
        var state = false;
        var idx, val, f, i, j;
        for (i = 0, il = this._animation.anim.length; i < il; i++) {
            f = this._animation.anim[i];
            if (!f.ended) {
                if (f.start.idx <= sec && sec < f.end.idx) {
                    idx = (sec - f.start.idx) / (f.end.idx - f.start.idx);
                    if (f.start.value instanceof Array) {
                        val = [];
                        for (j = 0; j < f.start.value.length; j++) {
                            //val.push(f.start.value[j]*(1-idx) + f.end.value[j]*idx);
                            val.push(this._animInterp(f.start.state, f.start.value[j], f.end.value[j], idx));
                        }
                    } else {
                        //val = f.start.value * (1-idx) + f.end.value * idx;
                        val = this._animInterp(f.start.state, f.start.value, f.end.value, idx);
                    }
                    this.setState(f.start.state, val);
                    state = true;
                } else if (sec >= f.end.idx) {
                    this.setState(f.end.state, f.end.value);
                    f.ended = true;
                } else if (sec < f.start.idx) {
                    state = true;
                }
            }
        }
        return state;
    };
    module.Axes3D.prototype._animInterp = function(state, startval, endval, idx) {
        switch (state) {
            case 'azimuth':
                // Azimuth is an angle, so we need to choose which direction to interpolate
                if (Math.abs(endval - startval) >= 180) { // wrap
                    if (startval > endval) {
                        return (startval * (1-idx) + (endval+360) * idx + 360) % 360;
                    }
                    else {
                        return (startval * (1-idx) + (endval-360) * idx + 360) % 360;
                    }
                } 
                else {
                    return (startval * (1-idx) + endval * idx);
                }
            default:
                // Everything else can be linearly interpolated
                return startval * (1-idx) + endval * idx;
        }
    };
    module.Axes3D.prototype.playpause = function() {
        if (this.state == "pause") {
            //Start playing
            this._startplay = (new Date()) - (this.frame * this.active.rate) * 1000;
            this.state = "play";
            this.schedule();
        } else {
            this.state = "pause";
        }
        this.figure.notify("playtoggle", this);
    };
    module.Axes3D.prototype.setGrid = function(m, n, idx) {
        //Establish of grid of views M rows by N columns
        if (this.views.length != m*n) {
            this.views = [];
            var scene, left, bottom, width = 1 / m, height = 1 / n;
            for (var i = 0; i < m; i++) {
                for (var j = 0; j < n; j++) {
                    left = i / m;
                    bottom = (n-i) / n;
                    scene = new THREE.Scene();
                    scene.add(this.camera);
                    this.views.push({left:left, bottom:bottom, width:width, height:height, scene:scene});
                }
            }
        }
        return this.views[idx].scene;
    }

    return module;
}(jsplot || {}));