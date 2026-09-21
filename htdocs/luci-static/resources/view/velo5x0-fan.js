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
		return 'WiFi';
	const core = /^Core\s+(\d+)$/.exec(sensor.label || '');
	return core ? _('CPU 核心') + ' ' + core[1] : 'CPU ' + (sensor.label || sensor.sensor);
}

function statusNodes(state) {
	return [
		E('strong', {}, state.running ? _('控制服务运行中') : _('控制服务未运行')),
		E('span', {}, ' · ' + _('当前输出 PWM') + ' ' + (state.duty == null ? '-' : Math.round(state.duty * 100 / 255) + '%')),
		E('div', { style: 'display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:8px' },
			(state.sensors || []).map(function(sensor) {
				return E('span', {}, sensorLabel(sensor) + ': ' + sensor.value.toFixed(1) + ' °C');
			}))
	];
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
			return opt;
		}
		function speed(name, title, initial, tab) {
			const opt = option(tab || 'control', SpeedSlider, name, title);
			opt.min = 0;
			opt.max = 100;
			opt.step = 1;
			opt.initialDuty = initial;
			opt.datatype = 'range(0,100)';
			return opt;
		}

		o = option('control', form.ListValue, 'mode', _('控制方式'), 'curve');
		o.value('curve', _('自动温控'));
		o.value('manual', _('手动调速'));
		o = speed('manual_duty', _('PWM 风速 (%)'), 80);
		o.depends('mode', 'manual');

		o = automatic(option('control', form.ListValue, 'temp_src', _('温度源'), 'cpu'));
		o.value('cpu', _('CPU 温度'));
		o.value('wifi', _('WiFi 温度'));
		o.value('cpu_wifi_max', _('CPU / WiFi 最高温'));
		o.value('cpu_wifi_avg', _('CPU / WiFi 平均温'));
		o.value('emc', _('主板温度'));
		temperature('control', 'on_above', _('起转温度 (°C)'), '45');
		o = temperature('control', 't_max', _('满速温度 (°C)'), '60');
		o.validate = function(id, value) {
			return Number(value) > Number(s.getOption('on_above').formvalue(id)) ||
				_('满速温度必须高于起转温度');
		};
		o = temperature('control', 'off_below', _('停转温度 (°C，0 为常转)'), '42');
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
		o = option('advanced', form.ListValue, 'temp_sensor', _('CPU 核心'), 'temp2_input');
		o.depends({ mode: 'curve', temp_src: 'cpu', temp_mode: 'single' });
		(data[1].sensors || []).filter(x => x.source == 'cpu').forEach(function(sensor) {
			o.value(sensor.sensor, sensorLabel(sensor));
		});
		o = automatic(option('advanced', form.ListValue, 'curve_profile', _('风速曲线'), 'linear'));
		o.forcewrite = true;
		o.value('linear', _('线性升速'));
		o.value('custom', _('自定义四点曲线'));
		const ts = [45, 50, 55, 60], ds = [40, 110, 180, 255];
		for (let i = 1; i <= 4; i++) {
			o = option('advanced', form.Value, 'curve_t' + i, _('曲线点 %s 温度 (°C)').format(i), String(ts[i - 1]));
			o.depends({ mode: 'curve', curve_profile: 'custom' });
			o.datatype = 'range(0,100)';
			o.validate = function(id, value) {
				const prev = i > 1 ? Number(s.getOption('curve_t' + (i - 1)).formvalue(id)) : -1;
				return Number(value) > prev || _('曲线温度必须逐点递增');
			};
			o = option('advanced', SpeedSlider, 'curve_d' + i, _('曲线点 %s PWM (%)').format(i));
			o.initialDuty = ds[i - 1];
			o.min = 0; o.max = 100; o.step = 1;
			o.datatype = 'range(0,100)';
			o.depends({ mode: 'curve', curve_profile: 'custom' });
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
