---
"rpe-redux": minor
---

### 中文

**新增**

- 自动测速新增一个基于动态贝叶斯网络（DBN）的解码器，移植自 madmom 的节拍跟踪算法：它在整首曲子中保留多个速度假设，按最可能的路径解码节拍，对切分音和接近临界的速度更稳。
- 测得的 BPM 与时间偏移现在是精确值，不再受分析帧长度限制：解码出的拍点会重新对齐到原始波形的起音，再用最小二乘拟合出周期与起点，合成点击测试中 BPM 误差为 0、相位误差在 1 ms 内。
- 节拍层级会自动判定，避免把 128 BPM 的曲子测成 64。

**已知限制**

- 带摇摆（swing）的素材在听感上与半速等价，两种读法都成立，检测器会报告较慢的那个。

### English

**Added**

- Automatic timing detection gains a dynamic Bayesian network (DBN) decoder, ported from madmom's beat tracker: it keeps every tempo hypothesis alive across the track and decodes the most probable path, which is steadier on syncopated material and near-miss tempi.
- Measured BPM and time offset are now exact rather than limited by the analysis frame: decoded beats are re-aligned to the raw waveform attacks and one least-squares fit yields the period and the start, giving zero BPM error and under 1 ms phase error on synthetic click tracks.
- The metrical level is resolved automatically, so a 128 BPM track is no longer reported as 64.

**Known limits**

- Swung material sounds equivalent to half tempo, and both readings are defensible; the detector reports the slower one.
