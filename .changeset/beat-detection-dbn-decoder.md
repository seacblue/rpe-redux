---
"rpe-redux": minor
---

### 中文

**新增**

- 自动测速新增一个基于动态贝叶斯网络（DBN）的解码器，移植自 madmom 的节拍跟踪算法：它在整首曲子中保留多个速度假设，按最可能的路径解码节拍，对切分音和接近临界的速度更稳。合成点击测试中相位误差在 0.8 ms 内。

### English

**Added**

- Automatic timing detection gains a dynamic Bayesian network (DBN) decoder, ported from madmom's beat tracker: it keeps every tempo hypothesis alive across the track and decodes the most probable path, which is steadier on syncopated material and near-miss tempi. Phase error stays within 0.8 ms on synthetic click tracks.
