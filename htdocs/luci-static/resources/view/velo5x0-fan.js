'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require poll';
'require dom';

const getStatus = rpc.declare({ object: 'luci.velo5x0_fan', method: 'status', reject: true });

// Keep the native widget's value even when it equals its default.
const SpeedSlider = form.RangeSliderValue.extend({
	formvalue: form.Value.prototype.formvalue,
	renderWidget: function(section_id, option_index, cfgvalue) {
		const node = this.super('renderWidget', [section_id, option_index, cfgvalue]);
		const input = node.querySelector('input[type="range"]');
		// Themes may apply text-input padding to ranges, displacing both endpoints.
		Object.assign(input.style, {
			padding: '0', border: '0', margin: '0', boxShadow: 'none',
			height: '24px', minWidth: '0', width: '100%', flex: '1 1 120px'
		});
		input.setAttribute('aria-label', this.title);
		Object.assign(node.style, {
			display: 'flex', alignItems: 'center', gap: '8px',
			width: '100%', maxWidth: '360px'
		});
		const output = node.querySelector('output');
		Object.assign(output.style, { minWidth: '3ch', textAlign: 'right' });
		node.appendChild(E('span', {}, '%'));
		return node;
	},
	cfgvalue: function(section_id) {
		const raw = uci.get('velo5x0', section_id, this.option);
		return String(Math.round(Number(raw != null ? raw : this.initialDuty) * 100 / 255));
	},
	write: function(section_id, value) {
		uci.set('velo5x0', section_id, this.option, String(Math.round(Number(value) * 255 / 100)));
	}
});

function sensorLabel(sensor) {
	if (sensor.source == 'wifi')
		return _('WiFi 温度');
	if (sensor.source == 'emc')
		return _('主板温度');
	if (sensor.source == 'cpu' && !sensor.sensor && !sensor.label)
		return _('CPU 温度');
	const core = /^Core\s+(\d+)$/.exec(sensor.label || '');
	return core ? _('CPU 核心') + ' ' + core[1] : 'CPU ' + (sensor.label || sensor.sensor);
}

function statusNodes(state) {
	const sensors = state.sensors || [];
	const visible = sensors.filter(sensor => sensor.source != 'emc' && sensor.source != 'cpu');
	const cpu = sensors.filter(sensor => sensor.source == 'cpu' && Number.isFinite(sensor.value));
	if (cpu.length)
		visible.unshift({ source: 'cpu', value: Math.max(...cpu.map(sensor => sensor.value)) });
	const board = sensors.filter(sensor => sensor.source == 'emc' && Number.isFinite(sensor.value));
	if (board.length)
		visible.push({ source: 'emc', value: Math.max(...board.map(sensor => sensor.value)) });
	return [
		E('strong', {}, state.running ? _('控制服务运行中') : _('控制服务未运行')),
		E('span', {}, ' · ' + _('当前输出 PWM') + ' ' + (state.duty == null ? '-' : Math.round(state.duty * 100 / 255) + '%')),
		E('div', { style: 'display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:8px' },
			visible.map(function(sensor) {
				return E('span', {}, sensorLabel(sensor) + ': ' + sensor.value.toFixed(1) + ' °C');
			}))
	];
}

function withHelp(opt, text) {
	const render = opt.renderWidget;
	opt.renderWidget = function() {
		const node = render.apply(this, arguments);
		const bubble = E('span', {
			role: 'tooltip',
			style: 'display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:20;width:max-content;max-width:280px;padding:6px 8px;border:1px solid #888;border-radius:4px;background:#fff;color:#222;box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:.9em;line-height:1.4;white-space:normal'
		}, text);
		let pinned = false;
		function show() {
			bubble.style.display = 'block';
		}
		function hide() {
			if (!pinned)
				bubble.style.display = 'none';
		}
		const help = E('button', {
			type: 'button',
			class: 'velo5x0-help',
			'aria-label': text,
			'aria-expanded': 'false',
			tabindex: '0',
			style: 'display:inline-flex;align-items:center;justify-content:center;width:1.25em;height:1.25em;padding:0;border:1px solid currentColor;border-radius:50%;background:transparent;color:inherit;font:inherit;font-size:.8em;line-height:1;cursor:help;flex:0 0 auto'
		}, '?');
		help.addEventListener('mouseenter', show);
		help.addEventListener('mouseleave', hide);
		help.addEventListener('focus', show);
		help.addEventListener('blur', hide);
		help.addEventListener('click', function(event) {
			event.preventDefault();
			pinned = !pinned;
			help.setAttribute('aria-expanded', pinned ? 'true' : 'false');
			if (pinned)
				show();
			else
				bubble.style.display = 'none';
		});
		bubble.addEventListener('mouseenter', show);
		bubble.addEventListener('mouseleave', hide);
		return E('span', {
			style: 'position:relative;display:flex;align-items:center;gap:6px;width:100%;max-width:100%'
		}, [node, E('span', { style: 'position:relative;display:inline-flex;flex:0 0 auto' }, [help, bubble])]);
	};
	return opt;
}

return view.extend({
	load: function() {
		return Promise.all([uci.load('velo5x0'), getStatus()]);
	},
	render: function(data) {
		const m = new form.Map('velo5x0', _('温度控制'));
		const s = m.section(form.TypedSection, 'fan');
		s.anonymous = true;
		s.addremove = false;
		s.tab('control', _('风扇控制'));
		s.tab('advanced', _('高级设置'));

		let statusNode;
		let o = s.taboption('control', form.DummyValue, '_status', _('实时状态'));
		o.renderWidget = function() {
			statusNode = E('div', {}, statusNodes(data[1] || {}));
			return statusNode;
		};

		function option(tab, type, name, title, initial) {
			const opt = s.taboption(tab, type, name, title);
			opt.default = initial;
			opt.rmempty = false;
			opt.retain = true;
			return opt;
		}
		function automatic(opt) {
			opt.depends('mode', 'curve');
			return opt;
		}
		function temperature(tab, name, title, initial) {
			const opt = automatic(option(tab, form.Value, name, title, initial));
			opt.datatype = 'range(0,100)';
			return withHelp(opt, {
				on_above: _('温度达到此值后开始带动风扇。'),
				t_max: _('温度达到此值后使用 100% PWM。'),
				off_below: _('自动模式下温度不高于此值时停转；填 0 表示不启用停转。')
			}[name]);
		}
		function speed(name, title, initial, tab) {
			const opt = option(tab || 'control', SpeedSlider, name, title);
			opt.min = 0;
			opt.max = 100;
			opt.step = 1;
			opt.initialDuty = initial;
			opt.datatype = 'range(0,100)';
			return withHelp(opt, {
				manual_duty: _('手动调速时固定使用的 PWM 输出。'),
				min_duty: _('自动线性曲线在低温端使用的 PWM；不代表转速，也不影响手动模式。')
			}[name]);
		}

		o = option('control', form.ListValue, 'mode', _('控制方式'), 'curve');
		o.value('curve', _('自动温控'));
		o.value('manual', _('手动调速'));
		o = withHelp(o, _('自动温控按温度曲线调速；手动调速固定使用下方 PWM。'));
		o = speed('manual_duty', _('PWM 风速 (%)'), 80);
		o.depends('mode', 'manual');

		o = automatic(option('control', form.ListValue, 'temp_src', _('温度源'), 'cpu'));
		o.value('cpu', _('CPU 温度'));
		o.value('wifi', _('WiFi 温度'));
		o.value('emc', _('主板温度'));
		o.value('cpu_wifi_max', _('CPU / WiFi /主板最高温'));
		o.value('cpu_wifi_avg', _('CPU / WiFi /主板平均温'));
		o = withHelp(o, _('选择自动调速使用的温度；组合选项会把 CPU、WiFi 和主板传感器一起计算。'));
		temperature('control', 'on_above', _('起转温度 (°C)'), '45');
		o = temperature('control', 't_max', _('满速温度 (°C)'), '60');
		o.validate = function(id, value) {
			return Number(value) > Number(s.getOption('on_above').formvalue(id)) ||
				_('满速温度必须高于起转温度');
		};
		o = temperature('control', 'off_below', _('停转温度 (°C)'), '42');
		o.validate = function(id, value) {
			return Number(value) == 0 || Number(value) < Number(s.getOption('on_above').formvalue(id)) ||
				_('停转温度必须低于起转温度');
		};
		o = speed('min_duty', _('低温风速'), 40, 'advanced');
		o.depends({ mode: 'curve', curve_profile: 'linear' });

		o = option('advanced', form.ListValue, 'temp_mode', _('CPU 温度统计'), 'max');
		o.depends({ mode: 'curve', temp_src: 'cpu' });
		o.value('max', _('核心最高温'));
		o.value('avg', _('核心平均温'));
		o.value('single', _('单个核心'));
		o = withHelp(o, _('仅温度源为 CPU 温度时生效；选择所有核心最高、平均或指定单核。'));
		o = option('advanced', form.ListValue, 'temp_sensor', _('CPU 核心'), 'temp2_input');
		o.depends({ mode: 'curve', temp_src: 'cpu', temp_mode: 'single' });
		(data[1].sensors || []).filter(x => x.source == 'cpu').forEach(function(sensor) {
			o.value(sensor.sensor, sensorLabel(sensor));
		});
		o = withHelp(o, _('单个核心模式下，选择用于自动调速的 CPU 核心。'));
		o = automatic(option('advanced', form.ListValue, 'curve_profile', _('风速曲线'), 'linear'));
		o.forcewrite = true;
		o.value('linear', _('线性升速'));
		o.value('custom', _('自定义四点曲线'));
		o = withHelp(o, _('线性升速按起转到满速温度自动计算；自定义曲线使用下面四个温度/PWM 点。'));
		const ts = [45, 50, 55, 60], ds = [40, 110, 180, 255];
		for (let i = 1; i <= 4; i++) {
			o = option('advanced', form.Value, 'curve_t' + i, _('曲线点 %s 温度 (°C)').format(i), String(ts[i - 1]));
			o.depends({ mode: 'curve', curve_profile: 'custom' });
			o.datatype = 'range(0,100)';
			o.validate = function(id, value) {
				const prev = i > 1 ? Number(s.getOption('curve_t' + (i - 1)).formvalue(id)) : -1;
				return Number(value) > prev || _('曲线温度必须逐点递增');
			};
			o = withHelp(o, _('自定义曲线第 %s 个温度节点；必须比前一个节点高。').format(i));
			o = option('advanced', SpeedSlider, 'curve_d' + i, _('曲线点 %s PWM (%)').format(i));
			o.initialDuty = ds[i - 1];
			o.min = 0; o.max = 100; o.step = 1;
			o.datatype = 'range(0,100)';
			o.depends({ mode: 'curve', curve_profile: 'custom' });
			o = withHelp(o, _('自定义曲线在第 %s 个温度节点使用的 PWM 输出。').format(i));
		}

		return m.render().then(function(node) {
			poll.add(function() {
				return getStatus().then(function(state) {
					if (statusNode && statusNode.isConnected)
						dom.content(statusNode, statusNodes(state));
				}).catch(function() {
					if (statusNode && statusNode.isConnected)
						dom.content(statusNode, _('状态读取失败'));
				});
			}, 3);
			return node;
		});
	}
});
