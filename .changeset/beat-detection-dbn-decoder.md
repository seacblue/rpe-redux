---
"rpe-redux": patch
---

### 中文

**新增**

- 自动测速新增一个基于动态贝叶斯网络（DBN）的解码器，移植自 madmom 的节拍跟踪算法：它在整首曲子中保留多个速度假设，按最可能的路径解码节拍，对切分音和接近临界的速度更稳。
- 谱面速度上限提高到 360 BPM，350 BPM 谱面可以正确测出；实测 70 到 350 BPM 的合成点击全部零误差。
- 变速曲目会报告速度分段，供速度地图使用；阶跃与渐变的段落边界都能定位。

**改进**

- 测得的 BPM 与时间偏移现在是精确值，不再受分析帧长度限制：解码出的拍点会重新对齐到原始波形的起音，再用最小二乘拟合出周期与起点。
- 采用 madmom 的特征提取链路（44.1 kHz、100 fps、三档帧长、对数三角滤波器组、正半波差分），并按滤波器组的面积归一化分配各频段权重，避免高频细分被当成主拍。
- 节拍层级先由解码路径的区间直方图决定，再由起音拟合量化，兼顾正确性与精度。
- 噪声环境下的相位稳定性大幅提高：底噪被扣除、尺度改用分位数、起音搜索窗随节拍周期缩放。

**已知限制**

- 带摇摆（swing）的素材在听感上与半速等价，两种读法都成立，检测器会报告较慢的那个。
- 没有单一速度的素材（例如自由节奏的爵士）无法用一个 BPM 描述。

### English

**Added**

- Automatic timing detection gains a dynamic Bayesian network (DBN) decoder, ported from madmom's beat tracker: it keeps every tempo hypothesis alive across the track and decodes the most probable path, which is steadier on syncopated material and near-miss tempi.
- The tempo ceiling is raised to 360 BPM, so charts at 350 BPM are measured correctly; synthetic clicks from 70 to 350 BPM all report with zero error.
- Tracks that change tempo report their stretches, in the shape a tempo map takes; both stepped and gradual changes are located.

**Improvements**

- Measured BPM and time offset are now exact rather than limited by the analysis frame: decoded beats are re-aligned to the raw waveform attacks and one least-squares fit yields the period and the start.
- The feature stage follows madmom's preprocessing chain (44.1 kHz, 100 fps, three frame sizes, logarithmic triangular filterbank, positive half-wave difference), and the bands carry the filterbank's own area normalisation, so a busy high band is no longer mistaken for the beat.
- The metrical level is chosen from the decoded path's interval histogram and then quantified by the attack fit, which keeps both the right octave and the precision.
- Phase stability under noise is much improved: the floor is removed, the scale is a percentile rather than the peak, and the attack search window follows the beat period.

**Known limits**

- Swung material sounds equivalent to half tempo, and both readings are defensible; the detector reports the slower one.
- Material without one tempo, such as freely played jazz, cannot be described by a single BPM.
